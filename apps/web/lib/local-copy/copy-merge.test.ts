// Tests for the device copy in the store (reducer.ts "copied" and "merged", with the base use-local-copy.ts hands the
// first load): the server wins over the copy, a stale copy cannot bring back deleted conversations or people, changes
// made while the copy shows survive, a catch-up does not end the copy, and a copy that opens late is ignored. data.ts needs a Supabase URL, so a fake one is set first.

import assert from "node:assert/strict";
import { before, test } from "node:test";
import type { Contact, Profile, Thread } from "../types";
import type { CopyData } from "./sealed-copy";
import { withCopy } from "./snapshot";
import { listState } from "../app-store/thread-filters";

process.env.NEXT_PUBLIC_SUPABASE_URL ??= "http://localhost:54321";
process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??= "test";
type Mod = typeof import("../app-store/reducer");
type State = Mod["initial"];
type Loaded = Extract<Parameters<Mod["reducer"]>[1], { type: "merged" }>["data"];
let reducer: Mod["reducer"], initial: State, EMPTY_PROFILE: Profile;
before(async () => {
  ({ initial, reducer } = await import("../app-store/reducer"));
  ({ EMPTY_PROFILE } = await import("../data"));
});

const thread = (id: string, patch: Partial<Thread> = {}) => ({ id, lastMessageAt: "2026-11-01", status: "inbox", pinned: false, unread: false, summary: "", participantIds: [], ...patch } as Thread);
const contact = (id: string): Contact => ({ id, name: id, initials: "", hue: 0, isCompany: false, emails: [], phones: [] });
const copyOf = (patch: Partial<CopyData> = {}): CopyData => ({ threads: [], contacts: [], accounts: [], rules: [], writingExamples: [], profile: EMPTY_PROFILE, unsubscribes: [], tasks: [], ...patch });
const loaded = (patch: Partial<Loaded> = {}): Loaded => ({ ...copyOf(), contactsLoaded: true, ...patch });

/** The store's boot: the copy shown over the empty state, and the base the first load is merged against. */
function boot(copy: CopyData) {
  const base = initial;
  const copyBase: State = { ...base, ...withCopy(base, copy, EMPTY_PROFILE), fromCopy: true };
  return { shown: reducer(base, { type: "copied", data: copy }), copyBase, base };
}

test("the copy shows to screens at once, while the store still waits for the server", () => {
  const { shown } = boot(copyOf({ threads: [thread("a")] }));
  assert.equal(shown.loading, true);
  assert.equal(shown.fromCopy, true);
  assert.equal(listState(shown).loading, false);
  assert.deepEqual(shown.threads.map((t) => t.id), ["a"]);
});

test("the server wins over the copy, and the copy mark goes", () => {
  const { shown, copyBase } = boot(copyOf({ threads: [thread("a", { summary: "stale", unread: true })] }));
  const out = reducer(shown, { type: "merged", fresh: true, base: copyBase, data: loaded({ threads: [thread("a", { summary: "fresh", unread: false })] }) });
  assert.equal(out.threads[0].summary, "fresh");
  assert.equal(out.threads[0].unread, false);
  assert.equal(out.loading, false);
  assert.equal(out.fromCopy, false);
});

test("a conversation deleted since the copy was saved does not come back", () => {
  const { shown, copyBase, base } = boot(copyOf({ threads: [thread("a"), thread("deleted")] }));
  const data = loaded({ threads: [thread("a")] });
  assert.deepEqual(reducer(shown, { type: "merged", fresh: true, base: copyBase, data }).threads.map((t) => t.id), ["a"]);
  // Why the copy goes into the base: against the empty state the copy's rows would read as added here and be kept.
  assert.deepEqual(reducer(shown, { type: "merged", fresh: true, base, data }).threads.map((t) => t.id).sort(), ["a", "deleted"]);
});

test("changes made while the copy shows survive the load: an archive, and a conversation that arrived live", () => {
  const { shown, copyBase } = boot(copyOf({ threads: [thread("a")] }));
  let now = reducer(shown, { type: "patchThread", id: "a", patch: { status: "archived" } });
  now = reducer(now, { type: "upsertThread", thread: thread("live", { lastMessageAt: "2026-11-03" }) });
  const out = reducer(now, { type: "merged", fresh: true, base: copyBase, data: loaded({ threads: [thread("a", { summary: "fresh" })] }) });
  assert.deepEqual(out.threads.map((t) => [t.id, t.status]), [["live", "inbox"], ["a", "archived"]]);
  assert.equal(out.threads[1].summary, "fresh");
});

test("people the copy had are dropped when the full contact list no longer has them", () => {
  const { shown, copyBase } = boot(copyOf({ contacts: [contact("kept"), contact("merged-away")] }));
  const full = reducer(shown, { type: "merged", fresh: true, base: copyBase, data: loaded({ contacts: [contact("kept")] }) });
  assert.deepEqual(full.contacts.map((c) => c.id), ["kept"]);
  // When the contacts failed to load, the copy's people stay until the store's retry brings the list.
  const partial = reducer(shown, { type: "merged", fresh: true, base: copyBase, data: loaded({ contacts: [], contactsLoaded: false }) });
  assert.deepEqual(partial.contacts.map((c) => c.id), ["kept", "merged-away"]);
});

test("a copy that opens after the load landed is ignored, and so is one after sign-out", () => {
  const landed = reducer(initial, { type: "merged", base: initial, data: loaded({ threads: [thread("a")] }) });
  assert.equal(reducer(landed, { type: "copied", data: copyOf({ threads: [thread("stale")] }) }), landed);
  const signedOut = reducer(initial, { type: "clear" });
  assert.equal(reducer(signedOut, { type: "copied", data: copyOf({ threads: [thread("stale")] }) }), signedOut);
});

test("a catch-up while the copy shows is applied but never makes the copy's rows count as fresh", () => {
  const { shown } = boot(copyOf({ threads: [thread("a"), thread("b", { summary: "stale" })] }));
  const caught = reducer(shown, { type: "merged", base: shown, data: loaded({ threads: [thread("a", { summary: "changed" }), thread("b", { summary: "stale" })], contactsLoaded: false }) });
  assert.equal(caught.threads.find((t) => t.id === "a")?.summary, "changed");
  assert.equal(caught.fromCopy, true);
  assert.equal(caught.loading, true);
  const full = reducer(caught, { type: "merged", fresh: true, base: caught, data: loaded({ threads: [thread("a", { summary: "changed" })] }) });
  assert.deepEqual(full.threads.map((t) => t.id), ["a"]);
  assert.equal(full.fromCopy, false);
  assert.equal(full.loading, false);
});
