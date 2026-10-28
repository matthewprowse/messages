// Filling the team's shared client list (public.workspace_contacts) when a chat is shared: every person in the chat
// joins it, with their addresses and numbers by team blind index, their company and who looks after them. The
// worker does it because it holds the agent's key (to read their contacts) and the team's (to seal and index).
// It runs when a to_work share job finishes, so the same chat can come round again (a follow-up job) and must change
// nothing the second time: the database matches a client by any of its indexes and only adds what is missing.

import { encryptTeamField } from "@messages/crypto";
import { teamAddressIndex, teamDomainIndex } from "@messages/crypto/addresses";
import { FIELD } from "@messages/crypto/fields";
import { isPlaceholderName as isPlaceholderSender } from "@messages/email-text/company";
import { isPlaceholderName } from "../contacts/match";
import { ownKeys, readPerson, type OwnAddresses, type Participant } from "./people";
import type { Keys, ThreadRow } from "./reseal";

/** A group with more people than this is a community, not a client: its members are not all added to the list. */
export const MAX_GROUP_CLIENTS = 10;

/** One client to add, sealed and indexed with the team's key (public.upsert_workspace_contact). */
export interface ClientUpsert {
  workspaceId: string;
  agentId: string;
  name: string;
  companyName: string | null;
  companyDomainIndex: string | null;
  identities: { kind: string; index: string; value: string }[];
}

/** What filling the list needs of the database (team-store.ts has the Supabase one, the tests a fake). */
export interface ClientStore {
  /** The people in each chat, as the agent's contacts. */
  participants(threadIds: string[]): Promise<Map<string, Participant[]>>;
  /** Every address and number that belongs to the agent or to a colleague in the workspace. */
  teamOwn(workspaceId: string): Promise<OwnAddresses>;
  /** Adds the client, or adds to the one it already is. Returns its id, null when nothing was added. */
  upsert(client: ClientUpsert): Promise<string | null>;
  /**
   * Links a shared chat to every client holding any of these team indexes (link_thread_clients), which is how a compliance
   * export finds a client's chats. Optional, so a store without it fills the list as before.
   */
  link?(workspaceId: string, threadId: string, indexes: string[]): Promise<void>;
}

export interface FillOutcome {
  /** People passed to the list (new, or already there and added to). */
  added: number;
  /** People left out: a colleague, a placeholder name, nothing to know them by, or a crowded group. */
  skipped: number;
  /** People whose values could not be opened. Counted, never logged by name. */
  failed: number;
}

/** True when a name says nothing about who it is: a number, an address, "No Reply". */
const placeholder = (name: string, addresses: string[]) => isPlaceholderName(name) || addresses.some((a) => a.includes("@") && isPlaceholderSender(name, a));

export async function fillClients(thread: Pick<ThreadRow, "id" | "user_id" | "workspace_id" | "is_group" | "shared_by">, store: ClientStore, keys: Keys): Promise<FillOutcome> {
  const outcome: FillOutcome = { added: 0, skipped: 0, failed: 0 };
  if (!thread.workspace_id) return outcome;
  // A shared inbox is read by everyone who uses it and anyone may write to it, so who writes there is not a client list: the
  // rule would otherwise share an agent's personal chat with someone who once emailed info@. Its chat is still linked to the
  // clients the list already has (below), so an export of a client includes what they wrote to the inbox.
  const inbox = thread.shared_by === "account";
  const people = (await store.participants([thread.id])).get(thread.id) ?? [];
  if (thread.is_group && people.length > MAX_GROUP_CLIENTS) return inbox ? outcome : { ...outcome, skipped: people.length };
  if (!people.length) return outcome;

  const own = await store.teamOwn(thread.workspace_id);
  const ownSet = ownKeys(own);
  const team = await keys.team(thread.workspace_id);
  const linked = new Set<string>();
  for (const p of people) {
    try {
      const person = await readPerson(keys, thread.user_id, p, own, ownSet);
      if (!person || !person.identities.length || placeholder(person.name, person.identities.map((i) => i.value))) {
        outcome.skipped++;
        continue;
      }
      const identities = new Map<string, { kind: string; index: string; value: string }>();
      for (const i of person.identities) {
        const index = await teamAddressIndex(team, i.value);
        if (!identities.has(index)) identities.set(index, { kind: i.kind, index, value: await encryptTeamField(team, FIELD.address, i.value) });
      }
      for (const index of identities.keys()) linked.add(index);
      if (inbox) continue;
      const id = await store.upsert({
        workspaceId: thread.workspace_id,
        agentId: thread.user_id,
        name: await encryptTeamField(team, FIELD.name, person.name),
        companyName: person.companyName ? await encryptTeamField(team, FIELD.name, person.companyName) : null,
        companyDomainIndex: person.companyDomain ? await teamDomainIndex(team, person.companyDomain) : null,
        identities: [...identities.values()],
      });
      if (id) outcome.added++;
      else outcome.skipped++;
    } catch {
      outcome.failed++; // one person whose values cannot be opened does not stop the rest
    }
  }
  // After the people are added, so a client this chat just made is linked to it too. A failure is the caller's to log: it
  // is not a person that could not be read.
  if (linked.size && store.link) await store.link(thread.workspace_id, thread.id, [...linked]);
  return outcome;
}
