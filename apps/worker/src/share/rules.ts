// The team rule pass: matches members' recent chats against the shared client list and either shares them or suggests
// sharing. The comment below the imports explains the rules and why it is a sweep.

import type { TeamKeys } from "@messages/crypto";
import { teamAddressIndex, teamDomainIndex } from "@messages/crypto/addresses";
import { errorCode, log } from "../log";
import { ownKeys, readPerson, type OwnAddresses, type Participant } from "./people";
import type { Keys } from "./reseal";

// The rule pass of step 4 of Teams (20261101130000_team_contacts.sql). Every few minutes it looks at each active
// member's recent chats that nothing has decided yet and asks two questions of them:
//
//   * Is anyone in the chat a team client (an address or number in workspace_contact_identities), or from a client
//     company (a domain in workspace_companies)? For a client, apply_team_rule shares the chat at once from the start,
//     or under strict sharing only suggests it, because accepting is irreversible and the agent must choose. A company
//     match is only ever suggested: anyone at a client company, a bank or a medical aid say, may be a personal contact.
//   * Did triage mark it as work? suggest_work_chats then suggests it to the agent alone.
//
// A sweep, rather than a check as each message arrives, because it touches no connector and one place decides: a new
// client, a new member or a late category is caught by the next pass. It costs a read of recent chats per member, and
// nothing at all for a workspace with no clients yet. Groups are never shared by the rule (they can be suggested by
// the category or marked by hand); a chat moved back to personal, or answered Not Work, is left alone.

/** How far back a chat's last message may be for the rule to look at it. */
export const RULE_DAYS = 30;
/** How far back a work chat may be to be suggested. Longer, so someone joining a team sees their recent clients. */
export const SUGGEST_DAYS = 90;
const BATCH = 100;

export interface RuleData {
  /** The client list: team index of an address, number or chat ID -> the client's name, sealed with the team key. */
  identities: Map<string, string>;
  /** The client companies: team index of a domain -> the company's name, sealed with the team key. */
  companies: Map<string, string>;
}

export interface Candidate {
  id: string;
  workspace_id: string | null;
  share_opt_out: boolean;
  share_suggestion: string | null;
  is_group: boolean;
  status: string;
}

export interface RuleStore {
  /** Every workspace. Whether it is strict is the database's business (apply_team_rule decides share or suggest). */
  workspaces(): Promise<{ id: string }[]>;
  /** The active members of a workspace. */
  members(workspaceId: string): Promise<string[]>;
  data(workspaceId: string): Promise<RuleData>;
  teamOwn(workspaceId: string): Promise<OwnAddresses>;
  /** A member's recent personal chats that may still be shared: the store leaves out what it knows is decided. */
  candidates(userId: string, sinceIso: string): Promise<Candidate[]>;
  participants(threadIds: string[]): Promise<Map<string, Participant[]>>;
  /** apply_team_rule: shared, suggested, or null when the chat was not eligible. A company match only ever suggests. */
  apply(threadId: string, sealedMatch: string, by: MatchBy): Promise<"shared" | "suggested" | null>;
  /** suggest_work_chats: how many chats triage's work category newly suggested. */
  suggestWork(userId: string, sinceIso: string): Promise<number>;
}

export interface RuleOutcome {
  /** Chats the rule shared. */
  shared: number;
  /** Chats the rule suggested, because strict sharing is on. */
  ruleSuggested: number;
  /** Chats suggested from triage's work category. */
  workSuggested: number;
  failed: number;
}

/** The database does not have step 4's tables or functions yet: PostgREST's codes for a missing function or table, and Postgres's. */
export const isMissingMigration = (err: unknown) => ["PGRST202", "PGRST205", "42P01", "42703", "42883"].includes(errorCode(err));

/** Whether a chat is still open to the rule. The store filters the same way; this is the check that does not trust it. */
const open = (c: Candidate) => !c.workspace_id && !c.share_opt_out && !c.is_group && c.status !== "trash" && c.share_suggestion !== "dismissed";

/** A client is matched by one of their own addresses or numbers; a company by the domain of anyone who works there. */
export type MatchBy = "client" | "company";

/**
 * The sealed name of the client or client company a chat's people match, and how, or null. A client wins over a company.
 * Only a client match shares a chat by itself: anyone at a client company (a bank, a medical aid) may be personal.
 */
export async function matchChat(keys: Keys, team: TeamKeys, userId: string, people: Participant[], data: RuleData, own: OwnAddresses, ownSet: Set<string>): Promise<{ sealed: string; by: MatchBy } | null> {
  let company: string | null = null;
  for (const p of people) {
    const person = await readPerson(keys, userId, p, own, ownSet);
    if (!person) continue;
    for (const i of person.identities) {
      const client = data.identities.get(await teamAddressIndex(team, i.value));
      if (client) return { sealed: client, by: "client" };
    }
    if (!company && person.companyDomain) company = data.companies.get(await teamDomainIndex(team, person.companyDomain)) ?? null;
  }
  return company ? { sealed: company, by: "company" } : null;
}

export async function runRulePass(store: RuleStore, keys: Keys, now = new Date()): Promise<RuleOutcome> {
  const out: RuleOutcome = { shared: 0, ruleSuggested: 0, workSuggested: 0, failed: 0 };
  const ruleSince = new Date(now.getTime() - RULE_DAYS * 86_400_000).toISOString();
  const suggestSince = new Date(now.getTime() - SUGGEST_DAYS * 86_400_000).toISOString();

  for (const { id: workspaceId } of await store.workspaces()) {
    const data = await store.data(workspaceId);
    const hasClients = data.identities.size > 0 || data.companies.size > 0;
    const own = hasClients ? await store.teamOwn(workspaceId) : new Set<string>();
    const ownSet = ownKeys(own);
    const team = hasClients ? await keys.team(workspaceId) : null;

    for (const userId of await store.members(workspaceId)) {
      try {
        if (team) {
          const candidates = (await store.candidates(userId, ruleSince)).filter(open);
          for (let from = 0; from < candidates.length; from += BATCH) {
            const batch = candidates.slice(from, from + BATCH);
            const people = await store.participants(batch.map((c) => c.id));
            for (const c of batch) {
              try {
                const match = await matchChat(keys, team, userId, people.get(c.id) ?? [], data, own, ownSet);
                if (!match) continue;
                const result = await store.apply(c.id, match.sealed, match.by);
                if (result === "shared") out.shared++;
                else if (result === "suggested") out.ruleSuggested++;
              } catch (err) {
                if (isMissingMigration(err)) throw err;
                out.failed++;
                log.warn("team rule failed for a chat", { thread: c.id, code: errorCode(err) });
              }
            }
          }
        }
        // After the rule, so a chat it suggested or shared is not counted twice.
        out.workSuggested += await store.suggestWork(userId, suggestSince);
      } catch (err) {
        if (isMissingMigration(err)) throw err;
        out.failed++;
        log.warn("team rule failed for a member", { user: userId, code: errorCode(err) });
      }
    }
  }
  return out;
}
