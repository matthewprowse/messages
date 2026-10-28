// Which addresses and numbers are the user's own, so contact matching never treats their card or signature as another person.

import { db, must } from "../db";
import { openAddresses } from "../vault";

/**
 * Everything that is you on this user's accounts: email addresses and send addresses (lowercase), plus your
 * WhatsApp number and any number you linked with (E.164). Used so your own card or signature is never
 * mistaken for someone else.
 */
export async function ownIdentities(userId: string): Promise<Set<string>> {
  const accounts = await openAddresses(userId, must(await db.from("accounts").select("address, send_addresses, pairing_phone").eq("user_id", userId), "load own addresses"));
  const own = new Set<string>();
  for (const a of accounts) {
    for (const v of [a.address, ...(a.send_addresses ?? [])]) if (v?.trim()) own.add(v.trim().toLowerCase());
    if (a.pairing_phone) own.add(`+${a.pairing_phone}`);
  }
  return own;
}

const OWN_CACHE_MS = 60_000;
const ownCache = new Map<string, { at: number; own: Promise<Set<string>> }>();

/** ownIdentities, kept for a minute: ingest asks for every email. */
export function ownIdentitiesCached(userId: string): Promise<Set<string>> {
  const hit = ownCache.get(userId);
  if (hit && Date.now() - hit.at < OWN_CACHE_MS) return hit.own;
  const own = ownIdentities(userId);
  own.catch(() => ownCache.delete(userId));
  ownCache.set(userId, { at: Date.now(), own });
  return own;
}
