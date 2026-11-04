// One address book card reduced to what is stored in address_book_cards, and the key that names it there. Pure (no
// database), so the key rule is tested. cards-store.ts saves the rows.
//
// The key is a blind index under the user's index key (the same HMAC as the address indexes), not a plain hash: an
// unkeyed hash of a phone-only card could be reversed by trying every number (security audit 2026-11-03, H5).

import { blindIndex, type UserKeys } from "@messages/crypto";
import type { Card } from "../photos/cards";
import { toE164 } from "./signature-phones";

/** A card's name and addresses, normalised: emails lowercased, numbers in E.164, each sorted and once. */
export interface CardFields {
  name: string | null;
  emails: string[];
  phones: string[];
}

/** A card as stored, before its name and addresses are sealed. */
export interface CardRow extends CardFields {
  card_key: string;
}

/** A card's fields as they are stored and imported, or null when it has no address or number. */
export function cardFields(card: Card, countryCode: string): CardFields | null {
  const emails = [...new Set(card.emails.map((e) => e.trim().toLowerCase()).filter((e) => e.includes("@")))].sort();
  const phones = [...new Set(card.phones.map((p) => toE164(p, countryCode) ?? p.replace(/[^\d+]/g, "")).filter((p) => p.replace(/\D/g, "").length >= 7))].sort();
  if (emails.length + phones.length === 0) return null;
  return { name: card.name?.trim() || null, emails, phones };
}

/**
 * A card reduced to what is stored, with a key that stays the same while the card does (and the user's key does), or
 * null when it has no address or number. The "card:" prefix keeps the key apart from every address index.
 */
export async function cardRow(keys: UserKeys, card: Card, countryCode: string): Promise<CardRow | null> {
  const fields = cardFields(card, countryCode);
  if (!fields) return null;
  const card_key = await blindIndex(keys, `card:${JSON.stringify([fields.name, fields.emails, fields.phones])}`);
  return { card_key, ...fields };
}
