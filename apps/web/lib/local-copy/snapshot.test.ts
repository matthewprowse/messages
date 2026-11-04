// Tests for snapshot.ts: what the device copy keeps from the store (no bin, no unsaved tasks, only named people) and
// how a copy is laid under the live state (live rows win).

import test from "node:test";
import assert from "node:assert/strict";
import type { State } from "../app-store/reducer";
import type { Contact, Profile, Task, Thread } from "../types";
import { snapshotOf, trimCopy, withCopy } from "./snapshot";

const thread = (id: string, at = "2026-11-01T10:00:00Z", patch: Partial<Thread> = {}) => ({ id, lastMessageAt: at, status: "inbox", participantIds: [], summary: "", ...patch } as Thread);
const contact = (id: string): Contact => ({ id, name: id, initials: "", hue: 0, isCompany: false, emails: [], phones: [] });
const task = (id: string, patch: Partial<Task> = {}) => ({ id, accountId: "a", title: id, dueAt: null, dueAllDay: false, completed: false, ...patch } as Task);
const EMPTY = { name: "" } as Profile;
const state = (patch: Partial<State> = {}): State => ({
  loading: true, fromCopy: false, threads: [], byThread: {}, contacts: [], accounts: [], rules: [], writingExamples: [], profile: EMPTY, unsubscribes: [], tasks: [], ...patch,
});

test("the copy leaves out the bin, tasks not yet stored, people no row names and every loaded message", () => {
  const s = state({
    threads: [thread("a", undefined, { participantIds: ["c1"], lastSenderId: "c2" }), thread("gone", undefined, { status: "trash", participantIds: ["c4"] })],
    contacts: [contact("c1"), contact("c2"), contact("c3"), contact("c4"), contact("c5")],
    tasks: [task("t1", { contactId: "c5" }), task("new-task-1")],
    byThread: { a: [{ id: "m1", body: "secret body" } as never] },
  });
  const copy = snapshotOf(s);
  assert.deepEqual(copy.threads.map((t) => t.id), ["a"]);
  assert.deepEqual(copy.contacts.map((c) => c.id), ["c1", "c2", "c5"]);
  assert.deepEqual(copy.tasks.map((t) => t.id), ["t1"]);
  assert.ok(!JSON.stringify(copy).includes("secret body"));
});

test("trimming keeps the newest conversations whatever order they are held in", () => {
  const copy = snapshotOf(state({ threads: [thread("old", "2026-01-01"), thread("new", "2026-11-01"), thread("mid", "2026-06-01")] }));
  assert.deepEqual(trimCopy(copy, 2).threads.map((t) => t.id), ["new", "mid"]);
  assert.deepEqual(trimCopy(copy, 0).threads, []);
});

test("laid under the live state, rows already held win and the copy fills in the rest, newest first", () => {
  const live = state({ threads: [thread("a", "2026-11-02", { summary: "live" })], profile: { name: "Live" } as Profile });
  const copy = snapshotOf(state({ threads: [thread("a", "2026-10-01", { summary: "stale" }), thread("b", "2026-11-03")], profile: { name: "Copied" } as Profile }));
  const out = withCopy(live, copy, EMPTY);
  assert.deepEqual(out.threads.map((t) => [t.id, t.summary]), [["b", ""], ["a", "live"]]);
  assert.equal(out.profile.name, "Live");
  assert.equal(withCopy(state(), copy, EMPTY).profile.name, "Copied");
});
