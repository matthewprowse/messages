// Every address book card becomes a contact in Messages, so the people you know are in Contacts with
// their full saved names before they ever write. A card that matches one person updates them (the saved
// name wins); a card that matches nobody makes a new contact; a card that matches several people is left
// to the contact linker, which merges or suggests merging them. Cards that are you are never imported.

import type { Json } from "@messages/db";
import { db, must } from "../db";
import { errorCode, log } from "../log";
import { userCountryCode } from "../contacts/cards-store";
import { cardFields } from "../contacts/card-row";
import { ownIdentities } from "../contacts/own";
import { addressIndex, domainIndex } from "@messages/crypto/addresses";
import { companyDomain, companyNameForDomain } from "@messages/email-text/company";
import { FIELD } from "@messages/crypto/fields";
import { keysFor, open, sealAddress, sealDomain, sealName } from "../vault";
import { chunks } from "../util";
import type { Card } from "./cards";
import { cardName, importRows, type Identity } from "./import-plan";

/** The stored names of these contacts, opened, by id. */
async function currentNames(userId: string, ids: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  for (const batch of chunks(ids, 200)) {
    const rows = must(await db.from("contacts").select("id, display_name").eq("user_id", userId).in("id", batch), "load contact names");
    for (const r of rows) out.set(r.id, (await open(userId, FIELD.name, r.display_name)) ?? "");
  }
  return out;
}

/** Imports the cards. Returns how many contacts were created, so the caller knows to reload identities. Never throws. */
export async function importCards(account: { id: string; user_id: string }, cards: Card[], identities: Identity[]): Promise<number> {
  try {
    const [countryCode, own] = await Promise.all([userCountryCode(account.user_id), ownIdentities(account.user_id)]);
    const rows = importRows(cards, identities, (card) => cardFields(card, countryCode), own);
    if (rows.length === 0) return 0;
    // Each address with the index the database matches on, and the company of the first email.
    const keys = await keysFor(account.user_id);
    const current = await currentNames(account.user_id, rows.map((r) => r.contact_id).filter((id): id is string => !!id));
    const payload = await Promise.all(
      rows.map(async (r) => {
        const domain = r.emails[0] ? companyDomain(r.emails[0], own) : null;
        return {
          contact_id: r.contact_id,
          // Names are sealed, so the database cannot tell an unchanged name from a new one: an existing contact's
          // name is sent only when it differs from the stored one (cardName), which also leaves every other row unwritten.
          name: await sealName(account.user_id, cardName(r.name, r.contact_id ? current.get(r.contact_id) : undefined), { place: "contacts.display_name" }),
          // A card with no name is named by its first address or number, sealed as a name.
          fallback_name: await sealName(account.user_id, r.emails[0] ?? r.phones[0] ?? null, { place: "contacts.display_name" }),
          identities: await Promise.all([
            ...r.emails.map(async (value) => ({ kind: "email", value: await sealAddress(account.user_id, value), index: await addressIndex(keys, value) })),
            ...r.phones.map(async (value) => ({ kind: "phone", value: await sealAddress(account.user_id, value), index: await addressIndex(keys, value) })),
          ]),
          company: domain ? { index: await domainIndex(keys, domain), domain: await sealDomain(account.user_id, domain), name: await sealName(account.user_id, companyNameForDomain(domain), { place: "organizations.name" }) } : null,
        };
      }),
    );
    const result = must(await db.rpc("import_address_book_cards", { p_user: account.user_id, p_cards: payload as unknown as Json }), "import address book") as unknown as {
      created: number;
      named: number;
    };
    log.info("address book imported", { account: account.id, cards: rows.length, created: result.created, named: result.named });
    return result.created;
  } catch (err) {
    log.warn("address book import failed", { account: account.id, code: errorCode(err) });
    return 0;
  }
}
