import { deriveTeamKeys, deriveUserKeys, encryptField, newDataKey, type TeamKeys, type UserKeys } from "@messages/crypto";
import { teamAddressIndex, teamDomainIndex } from "@messages/crypto/addresses";
import { FIELD } from "@messages/crypto/fields";
import { encryptTeamField } from "@messages/crypto";
import type { ClientStore, ClientUpsert } from "./clients";
import type { Participant } from "./people";
import type { Keys } from "./reseal";

// Real keys and an in-memory client list for the tests of clients.ts and rules.ts. The fake list keeps the rules of
// public.upsert_workspace_contact (20261101130000_team_contacts.sql, checked against a real Postgres when it was
// written): a client is the oldest one holding any of the indexes, only missing addresses are added, a company is
// filled in once, and the agent is linked.

export const WS = "ws-1";
export const AGENT = "agent-1";
export const COLLEAGUE = "agent-2";

export interface World {
  user: UserKeys;
  other: UserKeys;
  team: TeamKeys;
  keys: Keys;
}

export async function world(): Promise<World> {
  const user = await deriveUserKeys(newDataKey());
  const other = await deriveUserKeys(newDataKey());
  const team = await deriveTeamKeys(newDataKey());
  return { user, other, team, keys: { user: async (id) => (id === COLLEAGUE ? other : user), team: async () => team } };
}

/** A contact as stored: name and addresses sealed with the agent's key, as they are once ENCRYPT_ADDRESSES is on. */
export async function contact(
  w: World,
  name: string | null,
  identities: [kind: string, value: string][],
  org?: { name: string; domain: string },
  keys: UserKeys = w.user,
): Promise<Participant> {
  return {
    name: name == null ? null : await encryptField(keys, FIELD.name, name),
    identities: await Promise.all(identities.map(async ([kind, value]) => ({ kind, value: await encryptField(keys, FIELD.address, value) }))),
    organization: org ? { name: await encryptField(keys, FIELD.name, org.name), domain: await encryptField(keys, FIELD.domain, org.domain) } : null,
  };
}

export interface FakeClient {
  id: string;
  name: string;
  companyName: string | null;
  companyDomainIndex: string | null;
  identities: Map<string, { kind: string; value: string }>;
  agents: Set<string>;
}

export class FakeClients implements ClientStore {
  clients: FakeClient[] = [];
  companies = new Map<string, string>();
  calls: ClientUpsert[] = [];
  /** What link() was asked: the chat and the team indexes of the people in it. */
  links: { workspaceId: string; threadId: string; indexes: string[] }[] = [];
  people = new Map<string, Participant[]>();
  own = new Set<string>(["agent@mine.test", "+27820000000"]);
  members = new Set<string>([AGENT, COLLEAGUE]);

  async participants(threadIds: string[]) { return new Map(threadIds.filter((t) => this.people.has(t)).map((t) => [t, this.people.get(t)!] as const)); }
  async teamOwn() { return this.own; }
  async link(workspaceId: string, threadId: string, indexes: string[]) { this.links.push({ workspaceId, threadId, indexes }); }

  async upsert(c: ClientUpsert) {
    this.calls.push(c);
    if (!c.name || !c.identities.length || !this.members.has(c.agentId)) return null;
    let client = this.clients.find((x) => c.identities.some((i) => x.identities.has(i.index)));
    if (!client) {
      client = { id: `client-${this.clients.length + 1}`, name: c.name, companyName: c.companyName, companyDomainIndex: c.companyDomainIndex, identities: new Map(), agents: new Set() };
      this.clients.push(client);
    } else {
      client.companyName ??= c.companyName;
      client.companyDomainIndex ??= c.companyDomainIndex;
    }
    for (const i of c.identities) if (!client.identities.has(i.index)) client.identities.set(i.index, { kind: i.kind, value: i.value });
    client.agents.add(c.agentId);
    if (c.companyDomainIndex && c.companyName && !this.companies.has(c.companyDomainIndex)) this.companies.set(c.companyDomainIndex, c.companyName);
    return client.id;
  }
}

/** The rule's view of a client list: team index to the client's sealed name, and domain index to the company's. */
export async function client(w: World, name: string, addresses: string[], company?: { name: string; domain: string }) {
  return {
    name: await encryptTeamField(w.team, FIELD.name, name),
    indexes: await Promise.all(addresses.map((a) => teamAddressIndex(w.team, a))),
    company: company ? { index: await teamDomainIndex(w.team, company.domain), name: await encryptTeamField(w.team, FIELD.name, company.name) } : null,
  };
}
