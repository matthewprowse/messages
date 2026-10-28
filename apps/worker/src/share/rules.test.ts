// The rule pass over a fake database and real keys. The fake's apply keeps the rules of apply_team_rule and
// suggest_work_chats (20261101130000_team_contacts.sql, checked against a real Postgres when it was written): share or
// suggest by strictness, and leave alone what is shared, opted out, dismissed, a group or in the trash.

import assert from "node:assert/strict";
import { test } from "node:test";
import { decryptTeamField } from "@messages/crypto";
import { teamDomainIndex } from "@messages/crypto/addresses";
import { FIELD } from "@messages/crypto/fields";
import { AGENT, client, COLLEAGUE, contact, WS, world, type World } from "./fixtures";
import type { Participant } from "./people";
import { isMissingMigration, runRulePass, SignatureCache, SUGGEST_DAYS, type Candidate, type RuleData, type RuleStore } from "./rules";

interface Chat extends Candidate {
  user_id: string;
  category: string | null;
  match: string | null;
  shared_by: string | null;
  share_from: string | null;
}

class FakeRules implements RuleStore {
  strict = false;
  data_: RuleData = { identities: new Map(), companies: new Map() };
  chats: Chat[] = [];
  people = new Map<string, Participant[]>();
  own = new Set<string>(["agent@mine.test"]);
  members_ = [AGENT];
  candidateCalls = 0;
  suggestCalls: { user: string; since: string }[] = [];
  failApply = new Set<string>();
  /** Hands every chat of the member over, decided or not: the pass must not trust the store to have filtered. */
  async workspaces() { return [{ id: WS }]; }
  async members() { return this.members_; }
  async data() { return this.data_; }
  async teamOwn() { return this.own; }
  async candidates(userId: string) { this.candidateCalls++; return this.chats.filter((c) => c.user_id === userId).map((c) => ({ ...c })); }
  async participants(ids: string[]) { return new Map(ids.filter((i) => this.people.has(i)).map((i) => [i, this.people.get(i)!] as const)); }

  async apply(threadId: string, match: string, by: "client" | "company") {
    if (this.failApply.has(threadId)) throw Object.assign(new Error("boom"), { code: "ECONNRESET" });
    const c = this.chats.find((x) => x.id === threadId)!;
    if (c.workspace_id || c.share_opt_out || c.is_group || c.share_suggestion === "dismissed" || c.status === "trash") return null;
    if (this.strict || by === "company") { c.share_suggestion = "suggested"; c.match = match; return "suggested" as const; }
    c.match = match; c.workspace_id = WS; c.shared_by = "rule"; c.share_from = null; c.share_suggestion = null;
    return "shared" as const;
  }

  async suggestWork(userId: string, since: string) {
    this.suggestCalls.push({ user: userId, since });
    let n = 0;
    for (const c of this.chats) {
      if (c.user_id === userId && !c.workspace_id && !c.share_opt_out && c.share_suggestion === null && c.category === "work" && c.status !== "trash") { c.share_suggestion = "suggested"; n++; }
    }
    return n;
  }
}

let n = 0;
const chat = (over: Partial<Chat> = {}): Chat => ({
  id: `t-${++n}`, user_id: AGENT, workspace_id: null, share_opt_out: false, share_suggestion: null, is_group: false, status: "inbox",
  category: null, match: null, shared_by: null, share_from: null, ...over,
});

async function setup(w: World, strict = false) {
  const store = new FakeRules();
  store.strict = strict;
  const acme = await client(w, "Thandi Mokoena", ["thandi@acme.co.za", "+27821112222"], { name: "Acme Properties", domain: "acme.co.za" });
  for (const i of acme.indexes) store.data_.identities.set(i, acme.name);
  store.data_.companies.set(acme.company!.index, acme.company!.name);
  return store;
}

const withPeople = (store: FakeRules, c: Chat, people: Participant[]) => { store.chats.push(c); store.people.set(c.id, people); return c; };
const nameOf = (w: World, sealed: string | null) => decryptTeamField(w.team, FIELD.name, sealed!);

test("a chat with a team client is shared from the start by the rule, with the client's name", async () => {
  const w = await world();
  const store = await setup(w);
  const byAddress = withPeople(store, chat(), [await contact(w, "Thandi", [["email", "Thandi@Acme.co.za"]])]);
  const byNumber = withPeople(store, chat(), [await contact(w, "T", [["whatsapp", "+27821112222"]])]);
  const stranger = withPeople(store, chat(), [await contact(w, "Someone Else", [["email", "someone@elsewhere.co.za"]])]);
  const out = await runRulePass(store, w.keys);
  assert.equal(out.shared, 2);
  for (const c of [byAddress, byNumber]) {
    assert.equal(c.workspace_id, WS);
    assert.equal(c.shared_by, "rule");
    assert.equal(c.share_from, null, "the whole history");
    assert.equal(await nameOf(w, c.match), "Thandi Mokoena");
  }
  assert.equal(stranger.workspace_id, null);
  assert.equal(stranger.match, null);
});

test("someone from a client company matches by its domain, a client by name first", async () => {
  const w = await world();
  const store = await setup(w);
  const colleagueOfClient = withPeople(store, chat(), [await contact(w, "Pieter Botha", [["email", "pieter@mail.acme.co.za"]])]);
  const both = withPeople(store, chat(), [await contact(w, "Pieter Botha", [["email", "pieter@acme.co.za"]]), await contact(w, "Thandi", [["email", "thandi@acme.co.za"]])]);
  await runRulePass(store, w.keys);
  assert.equal(await nameOf(w, colleagueOfClient.match), "Acme Properties");
  assert.equal(colleagueOfClient.workspace_id, null, "a company match never shares by itself");
  assert.equal(colleagueOfClient.share_suggestion, "suggested", "it is suggested to the agent instead");
  assert.equal(await nameOf(w, both.match), "Thandi Mokoena");
  assert.equal(both.workspace_id, WS, "a client match shares");
});

test("a personal mail domain is never a client company, and the team's own addresses never match", async () => {
  const w = await world();
  const store = await setup(w);
  // a client company that is a personal provider could only come from a bad list: the person must still not match by it
  store.data_.companies.set(await teamDomainIndex(w.team, "gmail.com"), "sealed");
  const gmail = withPeople(store, chat(), [await contact(w, "Zanele Ndlovu", [["email", "zanele@gmail.com"]])]);
  // the agent writing to themself: their own address is in a list, but they are not a client
  const idx = (await client(w, "Me", ["agent@mine.test"])).indexes[0];
  store.data_.identities.set(idx, (await client(w, "Me", [])).name);
  const self = withPeople(store, chat(), [await contact(w, "Me", [["email", "agent@mine.test"]])]);
  const out = await runRulePass(store, w.keys);
  assert.equal(out.shared, 0);
  assert.equal(gmail.workspace_id, null);
  assert.equal(self.workspace_id, null);
});

test("strict sharing only suggests: the agent must choose, and the chat is not shared", async () => {
  const w = await world();
  const store = await setup(w, true);
  const c = withPeople(store, chat(), [await contact(w, "Thandi", [["email", "thandi@acme.co.za"]])]);
  const out = await runRulePass(store, w.keys);
  assert.deepEqual([out.shared, out.ruleSuggested], [0, 1]);
  assert.equal(c.workspace_id, null);
  assert.equal(c.share_suggestion, "suggested");
  assert.equal(await nameOf(w, c.match), "Thandi Mokoena");
});

test("a chat moved back to personal, one answered Not Work and a group are never shared by the rule", async () => {
  const w = await world();
  for (const strict of [false, true]) {
    const store = await setup(w, strict);
    const people = async () => [await contact(w, "Thandi", [["email", "thandi@acme.co.za"]])];
    const optedOut = withPeople(store, chat({ share_opt_out: true }), await people());
    const dismissed = withPeople(store, chat({ share_suggestion: "dismissed" }), await people());
    const group = withPeople(store, chat({ is_group: true }), await people());
    const trashed = withPeople(store, chat({ status: "trash" }), await people());
    const shared = withPeople(store, chat({ workspace_id: WS, shared_by: "agent" }), await people());
    const out = await runRulePass(store, w.keys);
    assert.deepEqual([out.shared, out.ruleSuggested, out.failed], [0, 0, 0], `strict ${strict}`);
    for (const c of [optedOut, dismissed, group, trashed]) assert.equal(c.match, null);
    assert.equal(shared.shared_by, "agent");
    assert.equal(dismissed.share_suggestion, "dismissed");
  }
});

test("a chat already suggested is still shared when its client is found and strict sharing is off", async () => {
  const w = await world();
  const store = await setup(w);
  const c = withPeople(store, chat({ share_suggestion: "suggested", category: "work" }), [await contact(w, "Thandi", [["email", "thandi@acme.co.za"]])]);
  await runRulePass(store, w.keys);
  assert.equal(c.workspace_id, WS);
  assert.equal(c.share_suggestion, null);
});

test("chats triage marked as work are suggested to the agent, nothing else", async () => {
  const w = await world();
  const store = await setup(w);
  const work = chat({ category: "work" });
  const personal = chat({ category: "personal" });
  const news = chat({ category: "newsletter" });
  const note = chat({ category: "notification" });
  const group = chat({ category: "work", is_group: true });
  const optedOut = chat({ category: "work", share_opt_out: true });
  const dismissed = chat({ category: "work", share_suggestion: "dismissed" });
  store.chats.push(work, personal, news, note, group, optedOut, dismissed);
  const now = new Date("2026-11-01T10:00:00Z");
  const out = await runRulePass(store, w.keys, now);
  assert.equal(out.workSuggested, 2); // the work chat and the group, which a category may suggest
  assert.equal(work.share_suggestion, "suggested");
  assert.equal(group.share_suggestion, "suggested");
  for (const c of [personal, news, note, optedOut]) assert.equal(c.share_suggestion, null);
  assert.equal(dismissed.share_suggestion, "dismissed");
  assert.deepEqual(store.suggestCalls, [{ user: AGENT, since: new Date(now.getTime() - SUGGEST_DAYS * 86_400_000).toISOString() }]);
  // a second pass changes nothing
  assert.equal((await runRulePass(store, w.keys, now)).workSuggested, 0);
});

test("a workspace with no clients yet still suggests work chats, and reads no chats for the rule", async () => {
  const w = await world();
  const store = new FakeRules();
  const work = chat({ category: "work" });
  store.chats.push(work);
  const out = await runRulePass(store, w.keys);
  assert.equal(out.workSuggested, 1);
  assert.equal(store.candidateCalls, 0);
});

test("every active member is swept, each with their own chats", async () => {
  const w = await world();
  const store = await setup(w);
  store.members_ = [AGENT, COLLEAGUE];
  const mine = withPeople(store, chat({ user_id: AGENT }), [await contact(w, "Thandi", [["email", "thandi@acme.co.za"]])]);
  const theirs = withPeople(store, chat({ user_id: COLLEAGUE }), [await contact(w, "Thandi M", [["email", "thandi@acme.co.za"]], undefined, w.other)]);
  const out = await runRulePass(store, w.keys);
  assert.equal(out.shared, 2);
  assert.equal(mine.shared_by, "rule");
  assert.equal(theirs.shared_by, "rule");
  assert.deepEqual(store.suggestCalls.map((c) => c.user), [AGENT, COLLEAGUE]);
});

test("one chat that fails does not stop the others", async () => {
  const w = await world();
  const store = await setup(w);
  const people = async () => [await contact(w, "Thandi", [["email", "thandi@acme.co.za"]])];
  const bad = withPeople(store, chat(), await people());
  const good = withPeople(store, chat(), await people());
  const unreadable = withPeople(store, chat(), [await contact(w, "Thandi", [["email", "thandi@acme.co.za"]], undefined, w.other)]); // not this agent's key
  store.failApply.add(bad.id);
  const out = await runRulePass(store, w.keys);
  assert.equal(out.shared, 1);
  assert.equal(out.failed, 2);
  assert.equal(good.shared_by, "rule");
  assert.equal(bad.workspace_id, null);
  assert.equal(unreadable.workspace_id, null);
});

test("a database without the migration stops the pass with a code the sweep waits on", async () => {
  const w = await world();
  const store = await setup(w);
  withPeople(store, chat(), [await contact(w, "Thandi", [["email", "thandi@acme.co.za"]])]);
  store.apply = async () => { throw Object.assign(new Error("missing"), { code: "PGRST202" }); };
  await assert.rejects(runRulePass(store, w.keys), (err) => isMissingMigration(err));
  assert.ok(!isMissingMigration(Object.assign(new Error("x"), { code: "ECONNRESET" })));
});

test("SignatureCache loads again only when the signature changes", async () => {
  const cache = new SignatureCache<number>();
  let loads = 0;
  let sig = "a";
  const get = (key = "ws") => cache.get(key, async () => sig, async () => ++loads);
  assert.equal(await get(), 1);
  assert.equal(await get(), 1);
  assert.equal(loads, 1);
  sig = "b";
  assert.equal(await get(), 2);
  assert.equal(await get("other"), 3);
  assert.equal(loads, 3);
});
