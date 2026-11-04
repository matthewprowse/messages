// Saves the address book cards the photo job reads, so the contact linker can tell which addresses and
// numbers belong to one person. Cards that disappear from the address book are deleted. Every sync reads the whole
// address book, so rows saved under an older kind of card_key (an unkeyed hash, before card-row.ts) are not in the new
// set: the next sync deletes them and saves each card again under its keyed name, with no separate rekey step.

import { addressIndex } from "@messages/crypto/addresses";
import { allRows, db, must } from "../db";
import { FIELD } from "@messages/crypto/fields";
import { keysFor, openAddresses, seal, sealAddress } from "../vault";
import { errorCode, log } from "../log";
import type { Card } from "../photos/cards";
import { chunks } from "../util";
import { cardRow, type CardRow } from "./card-row";
import { countryCodeOf, DEFAULT_COUNTRY_CODE, toE164 } from "./signature-phones";

/** The country for local numbers: from your own WhatsApp number, else a number you linked with, else +27. */
export async function userCountryCode(userId: string): Promise<string> {
  return countryCodeFrom(await openAddresses(userId, must(await db.from("accounts").select("provider, address, pairing_phone").eq("user_id", userId), "load country accounts")));
}

/** userCountryCode for accounts already loaded. */
export function countryCodeFrom(accounts: { provider: string; address: string; pairing_phone: string | null }[]): string {
  for (const a of accounts) {
    if (a.provider !== "whatsapp") continue;
    const cc = countryCodeOf(toE164(a.address, "0")) ?? countryCodeOf(a.pairing_phone ? `+${a.pairing_phone}` : null);
    if (cc) return cc;
  }
  for (const a of accounts) {
    const cc = countryCodeOf(a.pairing_phone ? `+${a.pairing_phone}` : null);
    if (cc) return cc;
  }
  return DEFAULT_COUNTRY_CODE;
}

/** Never throws: a failure here must not stop the photo sync. */
export async function saveCards(account: { id: string; user_id: string }, cards: Card[]): Promise<void> {
  try {
    const cc = await userCountryCode(account.user_id);
    const keys = await keysFor(account.user_id);
    const rows = new Map<string, CardRow>();
    for (const card of cards) {
      const row = await cardRow(keys, card, cc);
      if (row) rows.set(row.card_key, row);
    }

    const existing = (
      await allRows(
        (from, to) => db.from("address_book_cards").select("card_key").eq("account_id", account.id).order("card_key").range(from, to),
        "load saved cards",
      )
    ).map((r) => r.card_key);

    const saved = new Set(existing);
    const fresh = [...rows.values()].filter((r) => !saved.has(r.card_key));
    for (const batch of chunks(fresh, 500)) {
      // Stored with their indexes, so a contact's cards can be found by address without reading them.
      const stored = await Promise.all(
        batch.map(async (r) => ({
          ...r,
          name: await seal(account.user_id, FIELD.cardName, r.name),
          emails: await Promise.all(r.emails.map((e) => sealAddress(account.user_id, e))),
          phones: await Promise.all(r.phones.map((p) => sealAddress(account.user_id, p))),
          email_indexes: await Promise.all(r.emails.map((e) => addressIndex(keys, e))),
          phone_indexes: await Promise.all(r.phones.map((p) => addressIndex(keys, p))),
          user_id: account.user_id,
          account_id: account.id,
        })),
      );
      must(
        await db.from("address_book_cards").upsert(
          stored,
          { onConflict: "account_id,card_key" },
        ),
        "save cards",
      );
    }
    const gone = existing.filter((k) => !rows.has(k));
    for (const batch of chunks(gone, 200)) {
      must(await db.from("address_book_cards").delete().eq("account_id", account.id).in("card_key", batch), "delete cards");
    }
    log.info("address book saved", { account: account.id, cards: rows.size, added: fresh.length, removed: gone.length });
  } catch (err) {
    log.warn("address book save failed", { account: account.id, code: errorCode(err) });
  }
}
