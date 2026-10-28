// The Supabase side of step 4 of Teams: the shared client list, the rule pass and its schedule. The tables and
// functions are in 20261101130000_team_contacts.sql; link_thread_clients is in 20261104100000_team_after_launch.sql.

import { allRows, db, must } from "../db";
import { ownIdentitiesCached } from "../contacts/own";
import { startEvery } from "../backoff";
import { errorCode, log } from "../log";
import type { ClientStore } from "./clients";
import type { OwnAddresses, Participant } from "./people";
import { isMissingMigration, runRulePass, SignatureCache, type Candidate, type RuleStore } from "./rules";
import { keys } from "./store";

const PARTICIPANTS = "thread_id, contacts(display_name, contact_identities(kind, value), organizations(name, domain))";

async function participants(threadIds: string[]): Promise<Map<string, Participant[]>> {
  const out = new Map<string, Participant[]>();
  if (!threadIds.length) return out;
  const rows = must(await db.from("thread_participants").select(PARTICIPANTS).in("thread_id", threadIds), "load chat people");
  for (const r of rows) {
    if (!r.contacts) continue;
    const list = out.get(r.thread_id) ?? [];
    list.push({
      name: r.contacts.display_name,
      identities: r.contacts.contact_identities.map((i) => ({ kind: i.kind, value: i.value })),
      organization: r.contacts.organizations ? { name: r.contacts.organizations.name, domain: r.contacts.organizations.domain } : null,
    });
    out.set(r.thread_id, list);
  }
  return out;
}

/** Everything that is the address or number of any active member: the people the team is, so never its clients. */
async function teamOwn(workspaceId: string): Promise<OwnAddresses> {
  const members = must(await db.from("workspace_members").select("user_id").eq("workspace_id", workspaceId).eq("status", "active"), "load members");
  const own = new Set<string>();
  for (const m of members) for (const a of await ownIdentitiesCached(m.user_id)) own.add(a);
  return own;
}

export const clientStore: ClientStore = {
  participants,
  teamOwn,
  async upsert(c) {
    return must(
      await db.rpc("upsert_workspace_contact", {
        p_workspace: c.workspaceId,
        p_agent: c.agentId,
        p_name: c.name,
        p_company_name: c.companyName,
        p_company_domain_index: c.companyDomainIndex,
        p_identities: c.identities,
      }),
      "add team client",
    );
  },
  async link(workspaceId, threadId, indexes) {
    try {
      must(await db.rpc("link_thread_clients", { p_workspace: workspaceId, p_thread: threadId, p_indexes: indexes }), "link chat to team clients");
    } catch (err) {
      if (!isMissingMigration(err)) throw err; // the step 6 migration is not applied yet: the list is filled as before
    }
  },
};

/** Row count and newest timestamp of one of a workspace's client tables: changes whenever a client is added, changed or removed. */
async function tableSignature(table: "workspace_contacts" | "workspace_contact_identities", stamp: "updated_at" | "created_at", workspaceId: string): Promise<string> {
  const { data, count, error } = await (db.from(table) as unknown as { select(s: string, o: unknown): any })
    .select(stamp, { count: "exact" })
    .eq("workspace_id", workspaceId)
    .order(stamp, { ascending: false })
    .limit(1);
  if (error) throw Object.assign(new Error(`${table} signature failed`), { code: error.code });
  return `${count ?? 0}@${(data as Record<string, string>[])[0]?.[stamp] ?? ""}`;
}

const clientLists = new SignatureCache<{ identities: Map<string, string> }>();

async function loadClientList(workspaceId: string): Promise<{ identities: Map<string, string> }> {
  const [identities, clients] = await Promise.all([
    allRows((f, t) => db.from("workspace_contact_identities").select("value_index, workspace_contact_id").eq("workspace_id", workspaceId).order("value_index").range(f, t), "load client identities"),
    allRows((f, t) => db.from("workspace_contacts").select("id, name").eq("workspace_id", workspaceId).order("id").range(f, t), "load clients"),
  ]);
  const names = new Map(clients.map((c) => [c.id, c.name]));
  const byIndex = new Map<string, string>();
  for (const i of identities) {
    const name = names.get(i.workspace_contact_id);
    if (name) byIndex.set(i.value_index, name);
  }
  return { identities: byIndex };
}

export const ruleStore: RuleStore = {
  async workspaces() {
    return must(await db.from("workspaces").select("id"), "load workspaces");
  },

  async members(workspaceId) {
    return must(await db.from("workspace_members").select("user_id").eq("workspace_id", workspaceId).eq("status", "active"), "load members").map((m) => m.user_id);
  },

  // The client list (contacts and their identities, the big part) is read in full only when a cheap signature of it
  // changed. The companies are small and have no updated_at (a re-seal of their names would not show), so they are
  // always read. Before: 3 paged reads per workspace per pass; after: 2 one-row queries, plus the companies.
  async data(workspaceId) {
    const clients = await clientLists.get(
      workspaceId,
      async () => (await Promise.all([tableSignature("workspace_contacts", "updated_at", workspaceId), tableSignature("workspace_contact_identities", "created_at", workspaceId)])).join("|"),
      () => loadClientList(workspaceId),
    );
    const companies = await allRows((f, t) => db.from("workspace_companies").select("domain_index, name").eq("workspace_id", workspaceId).order("domain_index").range(f, t), "load client companies");
    return { identities: clients.identities, companies: new Map(companies.map((c) => [c.domain_index, c.name])) };
  },

  teamOwn,

  async candidates(userId, sinceIso): Promise<Candidate[]> {
    return must(
      await db.from("threads").select("id, workspace_id, share_opt_out, share_suggestion, is_group, status")
        .eq("user_id", userId).is("workspace_id", null).eq("share_opt_out", false).eq("is_group", false).neq("status", "trash")
        .or("share_suggestion.is.null,share_suggestion.eq.suggested").gte("last_message_at", sinceIso)
        .order("last_message_at", { ascending: false }).limit(500),
      "load chats to check",
    );
  },

  participants,

  async apply(threadId, sealedMatch, by) {
    return must(await db.rpc("apply_team_rule", { p_thread: threadId, p_match: sealedMatch, p_by: by }), "apply team rule") as "shared" | "suggested" | null;
  },

  async suggestWork(userId, sinceIso) {
    return must(await db.rpc("suggest_work_chats", { p_user: userId, p_since: sinceIso }), "suggest work chats");
  },
};

const FIRST_MS = 60_000;
const EVERY_MS = 3 * 60_000;
/** How long to leave the sweep alone when its migration has not been applied yet. */
const MISSING_WAIT_MS = 10 * 60_000;

/** Starts the rule pass: a minute after start, then every three minutes. Ids and counts are all it logs. */
export function startTeamRules() {
  let waitUntil = 0;
  startEvery(FIRST_MS, EVERY_MS, async () => {
    if (Date.now() < waitUntil) return;
    try {
      const out = await runRulePass(ruleStore, keys);
      if (out.shared || out.ruleSuggested || out.workSuggested || out.failed) log.info("team rule pass", { ...out });
    } catch (err) {
      if (!isMissingMigration(err)) throw err;
      waitUntil = Date.now() + MISSING_WAIT_MS;
      log.warn("team rules wait for their migration (20261101130000_team_contacts.sql)");
    }
  }, (err) => log.warn("team rule pass failed", { code: errorCode(err) }));
}
