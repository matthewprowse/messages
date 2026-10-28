// What a blind index is taken of, for addresses (encryption stage 2). The same address always gives the same
// token, however it was written, so the database can still match a sender to a contact, a reply to its
// conversation and a person to their company without holding any of them. Each kind is prefixed, so an
// email, a number and a domain never share a token. apps/ai/ai/crypto.py has the same rules: the shared
// vectors check both.

import { blindIndex, teamBlindIndex, type TeamKeys, type UserKeys } from "./index";

/** Who someone is: an email address, a phone number in E.164, or a WhatsApp lid ("<digits>@lid"). */
export function addressKey(value: string): string {
  const v = value.trim().toLowerCase();
  if (/^[0-9]+@lid$/.test(v)) return `lid:${v}`;
  if (v.includes("@")) return `email:${v}`;
  const digits = v.replace(/[\s().-]/g, "");
  if (/^\+?[0-9]{7,15}$/.test(digits)) return `phone:+${digits.replace(/^\+/, "")}`;
  return `other:${v}`;
}

/** A conversation's ID at its provider: a WhatsApp chat JID, or an email thread's root. */
export function chatKey(value: string): string {
  return `chat:${value.trim().toLowerCase()}`;
}

/** An email domain, with or without a leading @. */
export function domainKey(value: string): string {
  return `domain:${value.trim().toLowerCase().replace(/^@/, "").replace(/\.$/, "")}`;
}

export const addressIndex = (keys: UserKeys, value: string) => blindIndex(keys, addressKey(value));
export const chatIndex = (keys: UserKeys, value: string) => blindIndex(keys, chatKey(value));
export const domainIndex = (keys: UserKeys, value: string) => blindIndex(keys, domainKey(value));

// The same keys under a team's index key, for the team's shared contacts and chats: the same normalisation, so a
// value is written one way everywhere, and a different HMAC key, so a team's token never equals a user's.
export const teamAddressIndex = (keys: TeamKeys, value: string) => teamBlindIndex(keys, addressKey(value));
export const teamChatIndex = (keys: TeamKeys, value: string) => teamBlindIndex(keys, chatKey(value));
export const teamDomainIndex = (keys: TeamKeys, value: string) => teamBlindIndex(keys, domainKey(value));

/** A priority rule's target, a whole address or a domain (with or without its @). */
export const ruleTargetIndex = (keys: UserKeys, target: string) =>
  /^[^@\s]+@/.test(target.trim()) ? addressIndex(keys, target) : domainIndex(keys, target);
