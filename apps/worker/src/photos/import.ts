import type { Json } from "@messages/db";
import { db, must } from "../db";
import { errorCode, log } from "../log";
import { cardRow, userCountryCode } from "../contacts/cards-store";
import { ownIdentities } from "../contacts/own";
import { addressIndex, domainIndex } from "@messages/crypto/addresses";
import { companyDomain, companyNameForDomain } from "@messages/email-text/company";
import { keysFor, sealAddress, sealDomain } from "../vault";
import type { Card } from "./cards";
import { importRows, type Identity } from "./import-plan";

// Every address book card becomes a contact in Messages, so the people you know are in Contacts with
// their full saved names before they ever write. A card that matches one person updates them (the saved
// name wins); a card that matches nobody makes a new contact; a card that matches several people is left
// to the contact linker, which merges or suggests merging them. Cards that are you are never imported.

/** Imports the cards. Returns how many contacts were created, so the caller knows to reload identities. Never throws. */
export async function importCards(account: { id: string; user_id: string }, cards: Card[], identities: Identity[]): Promise<number> {
  try {
    const [countryCode, own] = await Promise.all([userCountryCode(account.user_id), ownIdentities(account.user_id)]);
    const rows = importRows(cards, identities, (card) => cardRow(card, countryCode), own);
    if (rows.length === 0) return 0;
    // Each address with the index the database matches on, and the company of the first email.
    const keys = await keysFor(account.user_id);
    const payload = await Promise.all(
      rows.map(async (r) => {
        const domain = r.emails[0] ? companyDomain(r.emails[0], own) : null;
        return {
          contact_id: r.contact_id,
          name: r.name,
          fallback_name: r.emails[0] ?? r.phones[0] ?? null,
          identities: await Promise.all([
            ...r.emails.map(async (value) => ({ kind: "email", value: await sealAddress(account.user_id, value), index: await addressIndex(keys, value) })),
            ...r.phones.map(async (value) => ({ kind: "phone", value: await sealAddress(account.user_id, value), index: await addressIndex(keys, value) })),
          ]),
          company: domain ? { index: await domainIndex(keys, domain), domain: await sealDomain(account.user_id, domain), name: companyNameForDomain(domain) } : null,
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
