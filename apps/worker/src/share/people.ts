// The people in a chat, as step 4 of Teams reads them (20261101130000_team_contacts.sql): the shared client list is
// filled from them, and the rule pass matches them against it. They are the agent's own contacts, so their names and
// addresses are opened with the agent's key. Nothing here is ever logged.

import { decryptField, isCiphertext, isTeamCiphertext } from "@messages/crypto";
import { addressKey } from "@messages/crypto/addresses";
import type { Field } from "@messages/crypto/fields";
import { FIELD } from "@messages/crypto/fields";
import { companyDomain, companyNameForDomain } from "@messages/email-text/company";
import { isRoleAddress } from "../contacts/match";
import type { Keys } from "./reseal";

/** A contact in a chat as stored: names and addresses may be sealed with the agent's key. */
export interface Participant {
  name: string | null;
  identities: { kind: string; value: string }[];
  organization: { name: string | null; domain: string | null } | null;
}

/** A contact read for the team: who they are, everything they are reached by, and the company they write for. */
export interface Person {
  name: string;
  identities: { kind: string; value: string }[];
  companyDomain: string | null;
  companyName: string | null;
}

/** Every address and number that is the agent's or a colleague's own, as lowercase emails and +numbers (ownIdentities). */
export type OwnAddresses = Set<string>;

/** A stored text as text: sealed with the agent's key it is opened, anything readable stays as it is. */
export async function readText(keys: Keys, userId: string, field: Field, value: string | null | undefined): Promise<string | null> {
  if (value == null || value === "") return null;
  if (!isCiphertext(value)) return value;
  // A contact's values are the agent's own; a team value here would be a row from somewhere it should not be.
  if (isTeamCiphertext(value)) throw new Error("unexpected team value");
  return decryptField(await keys.user(userId), field, value);
}

/** How an address or number is compared: written one standard way (addressKey), whichever way it was stored. */
export const ownKeys = (own: Iterable<string>): Set<string> => new Set([...own].map(addressKey));

/**
 * One contact read for the team. null when they are not a client: one of the team's own addresses or numbers is theirs
 * (a colleague copied in, the agent's other number), or nothing is left to know them by. Role addresses (noreply@,
 * info@) are dropped, because matching on them would share unrelated senders' chats.
 */
export async function readPerson(keys: Keys, userId: string, p: Participant, own: OwnAddresses, ownSet: Set<string> = ownKeys(own)): Promise<Person | null> {
  const identities: { kind: string; value: string }[] = [];
  for (const i of p.identities) {
    const value = (await readText(keys, userId, FIELD.address, i.value))?.trim();
    if (!value) continue;
    if (ownSet.has(addressKey(value))) return null;
    identities.push({ kind: i.kind, value });
  }
  const emails = identities.filter((i) => i.value.includes("@") && !/^[0-9]+@lid$/i.test(i.value)).map((i) => i.value);
  const domain = emails.map((e) => companyDomain(e, own)).find((d): d is string => !!d) ?? null;
  const kept = identities.filter((i) => !isRoleAddress(i.value));
  const name = (await readText(keys, userId, FIELD.name, p.name))?.trim() ?? "";
  let companyName: string | null = null;
  if (domain) {
    const org = p.organization;
    const orgDomain = (await readText(keys, userId, FIELD.domain, org?.domain))?.trim().toLowerCase();
    companyName = (orgDomain === domain && (await readText(keys, userId, FIELD.name, org?.name))?.trim()) || companyNameForDomain(domain);
  }
  return { name, identities: kept, companyDomain: domain, companyName };
}
