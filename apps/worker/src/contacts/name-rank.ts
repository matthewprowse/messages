// What kind of name a contact is given (contacts.display_name_rank), worked out by the writer while the name is still
// readable: the database stores it sealed, so it decides which name wins by this rank instead of reading it
// (20261125100000_sealed_names_columns.sql). Pure, so every connector's choice can be unit tested.

import { isPlaceholderName as isPlaceholderSender } from "@messages/email-text/company";
import { isPlaceholderName } from "./match";

/** 0 a stand-in (a number, an address, an ID, "WhatsApp Contact"), 1 a name the person set for themselves, 2 a real name. */
export type NameRank = 0 | 1 | 2;

export const STAND_IN: NameRank = 0;
export const SELF_SET: NameRank = 1;
export const REAL_NAME: NameRank = 2;

/**
 * An email participant's stored name: real when it is the name the header gave and that name says who they are, a
 * stand-in when it was made from their company or address (senderName) or only says "No Reply".
 */
export function emailNameRank(address: string, headerName: string | null | undefined, stored: string): NameRank {
  const given = (headerName ?? "").trim();
  if (!given || stored.trim() !== given) return STAND_IN;
  return isPlaceholderSender(given, address) || isPlaceholderName(given) ? STAND_IN : REAL_NAME;
}

/** A name a provider gave, or null when it gave none and a stand-in (the address, "LinkedIn Member") is used. */
export function givenNameRank(name: string | null | undefined): NameRank {
  const n = (name ?? "").trim();
  return !n || isPlaceholderName(n) ? STAND_IN : REAL_NAME;
}

/** The best WhatsApp name known: saved on your phone, else the one the person set, else their number or privacy ID. */
export function whatsappName(saved: string | null | undefined, pushed: string | null | undefined, fallback: string): { name: string; rank: NameRank } {
  if (saved?.trim()) return { name: saved, rank: REAL_NAME };
  if (pushed?.trim()) return { name: pushed, rank: SELF_SET };
  return { name: fallback, rank: STAND_IN };
}

/**
 * The merged contact's name when it should replace the kept one's: both real names, the kept one a single word and the
 * other a full name ("Geoff" and "Geoff Prowse"). merge_contacts did this while names were readable; with sealed names
 * the contact linker does it after the merge. null keeps the kept contact's name.
 */
export function fullerName(kept: string | null | undefined, merged: string | null | undefined): string | null {
  const k = (kept ?? "").trim();
  const m = (merged ?? "").trim();
  if (isPlaceholderName(k) || isPlaceholderName(m)) return null;
  return k.split(/\s+/).length === 1 && m.split(/\s+/).length >= 2 ? m : null;
}
