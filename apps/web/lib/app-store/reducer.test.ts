// Tests for reducer.ts: a fetch merged on top of newer local changes, unsubscribe rows keyed by account and sender,
// batched conversation upserts and eviction of held messages. data.ts needs a Supabase URL to load, so a fake one is set first.

import assert from "node:assert/strict";
import { before, test } from "node:test";
import type { Account, Task, Thread, Unsubscribe } from "../types";

process.env.NEXT_PUBLIC_SUPABASE_URL ??= "http://localhost:54321";
process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??= "test";
type Mod = typeof import("./reducer");
type State = Mod["initial"];
let reducer: Mod["reducer"], initial: State, EMPTY_PROFILE: Awaited<typeof import("../data")>["EMPTY_PROFILE"];
// Loaded after the fake URL is set, and not at the top: the test files are compiled as CommonJS, which has no top level await.
before(async () => {
  ({ initial, reducer } = await import("./reducer"));
  ({ EMPTY_PROFILE } = await import("../data"));
});

const thread = (id: string, patch: Partial<Thread> = {}) => ({ id, lastMessageAt: "2026-01-01", status: "inbox", pinned: false, unread: false, summary: "", preview: "", participantIds: [], ...patch } as Thread);
const task = (id: string, patch: Partial<Task> = {}) => ({ id, accountId: "a", title: id, dueAt: "2026-10-26T00:00:00Z", dueAllDay: true, completed: false, ...patch } as Task);
type Loaded = Extract<Parameters<Mod["reducer"]>[1], { type: "loaded" }>["data"];
const loaded = (patch: Partial<Loaded> = {}): Loaded => ({
  threads: [], contacts: [], contactsLoaded: true, accounts: [], rules: [], writingExamples: [], profile: EMPTY_PROFILE, unsubscribes: [], tasks: [], ...patch,
});
const state = (patch: Partial<State> = {}): State => ({ ...initial, loading: false, ...patch });

test("an archive made while the fetch ran survives the fetch", () => {
  const base = state({ threads: [thread("a")] });
  const now = reducer(base, { type: "patchThread", id: "a", patch: { status: "archived" } });
  const out = reducer(now, { type: "merged", base, data: loaded({ threads: [thread("a", { summary: "fresh" })] }) });
  assert.equal(out.threads[0].status, "archived");
  assert.equal(out.threads[0].summary, "fresh");
});

test("a pin and a feedback given meanwhile survive, and a draft the fetch brings is taken", () => {
  const base = state({ threads: [thread("a")] });
  let now = reducer(base, { type: "patchThread", id: "a", patch: { pinned: true } });
  now = reducer(now, { type: "feedback", id: "a", value: "important" });
  const out = reducer(now, { type: "merged", base, data: loaded({ threads: [thread("a", { draft: { id: "d" } as Thread["draft"] })] }) });
  assert.equal(out.threads[0].pinned, true);
  assert.equal(out.threads[0].feedback, "important");
  assert.equal(out.threads[0].draft?.id, "d");
});

test("a conversation that arrived by Realtime during the fetch stays, newest first", () => {
  const base = state({ threads: [thread("a", { lastMessageAt: "2026-01-01" })] });
  const now = reducer(base, { type: "upsertThread", thread: thread("new", { lastMessageAt: "2026-02-01" }) });
  const out = reducer(now, { type: "merged", base, data: loaded({ threads: [thread("a")] }) });
  assert.deepEqual(out.threads.map((t) => t.id), ["new", "a"]);
});

test("a conversation removed meanwhile is not brought back, one gone from the fetch goes", () => {
  const base = state({ threads: [thread("a"), thread("b")] });
  const now = reducer(base, { type: "removeThread", id: "a" });
  const out = reducer(now, { type: "merged", base, data: loaded({ threads: [thread("a")] }) });
  assert.deepEqual(out.threads, []);
});

test("profile edits, rules and tasks made meanwhile survive, a task not yet stored stays", () => {
  const base = state();
  let now = reducer(base, { type: "patchProfile", patch: { about: "mine" } });
  now = reducer(now, { type: "addRule", rule: { id: "r1", kind: "important", target: "x" } as never });
  now = reducer(now, { type: "upsertTask", task: task("new-task-1", { pending: true }) });
  const out = reducer(now, { type: "merged", base, data: loaded({ profile: { ...EMPTY_PROFILE, name: "Fetched" }, tasks: [task("t1")] }) });
  assert.equal(out.profile.about, "mine");
  assert.equal(out.profile.name, "Fetched");
  assert.deepEqual(out.rules.map((r) => r.id), ["r1"]);
  assert.deepEqual(out.tasks.map((t) => t.id).sort(), ["new-task-1", "t1"]);
  assert.equal(out.loading, false);
});

test("a task ticked meanwhile keeps its tick, and one deleted meanwhile stays deleted", () => {
  const base = state({ tasks: [task("t1"), task("t2")] });
  let now = reducer(base, { type: "patchTask", id: "t1", patch: { completed: true } });
  now = reducer(now, { type: "removeTask", id: "t2" });
  const out = reducer(now, { type: "merged", base, data: loaded({ tasks: [task("t1"), task("t2")] }) });
  assert.deepEqual(out.tasks.map((t) => [t.id, t.completed]), [["t1", true]]);
});

test("an account changed by Realtime meanwhile keeps its change", () => {
  const acc = (status: string) => ({ id: "x", status } as Account);
  const base = state({ accounts: [acc("ok")] });
  const now = reducer(base, { type: "patchAccount", id: "x", patch: { status: "error" } as never });
  const out = reducer(now, { type: "merged", base, data: loaded({ accounts: [acc("ok")] }) });
  assert.equal(out.accounts[0].status, "error");
});

test("tasksLoaded keeps a task made here and not yet stored", () => {
  const base: Task[] = [];
  const s = reducer(state(), { type: "upsertTask", task: task("new-task-9") });
  const out = reducer(s, { type: "tasksLoaded", base, tasks: [task("t1")] });
  assert.deepEqual(out.tasks.map((t) => t.id).sort(), ["new-task-9", "t1"]);
});

test("the same sender on two accounts is two unsubscribe rows, the same pair is one", () => {
  const u = (id: string, accountId: string, status = "pending") => ({ id, accountId, sender: "news@x.com", status } as Unsubscribe);
  let s = reducer(state(), { type: "upsertUnsubscribe", unsubscribe: u("1", "a") });
  s = reducer(s, { type: "upsertUnsubscribe", unsubscribe: u("2", "b") });
  assert.equal(s.unsubscribes.length, 2);
  s = reducer(s, { type: "upsertUnsubscribe", unsubscribe: u("3", "a", "done") });
  assert.deepEqual(s.unsubscribes.map((x) => x.id).sort(), ["2", "3"]);
});

test("upsertThreads adds new conversations at the front and updates held ones in place, keeping draft and feedback", () => {
  const s0 = state({ threads: [thread("a", { feedback: "important", draft: { id: "d" } as Thread["draft"] })] });
  const s1 = reducer(s0, { type: "upsertThreads", threads: [thread("a", { summary: "new" }), thread("n1"), thread("n2")], contacts: [] });
  assert.deepEqual(s1.threads.map((t) => t.id), ["n1", "n2", "a"]);
  assert.equal(s1.threads[2].summary, "new");
  assert.equal(s1.threads[2].feedback, "important");
  assert.equal(s1.threads[2].draft?.id, "d");
});

test("evictMessages drops the held messages of those conversations only", () => {
  const s0 = state({ byThread: { a: [], b: [] } });
  const s1 = reducer(s0, { type: "evictMessages", ids: ["a", "zzz"] });
  assert.deepEqual(Object.keys(s1.byThread), ["b"]);
  assert.equal(reducer(s1, { type: "evictMessages", ids: ["zzz"] }), s1);
});
