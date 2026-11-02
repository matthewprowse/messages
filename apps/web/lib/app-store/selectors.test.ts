// Tests for selectors.ts: queued replies are laid after stored messages, and lists sort pinned first, then by rank in Priority.
import assert from "node:assert/strict";
import { test } from "node:test";
import type { Message, Thread } from "../types";
import type { PendingSend } from "./compose";
import { listThreadsFor, withQueuedReplies } from "./selectors";

const thread = (over: Partial<Thread>) => ({ junk: false, subscription: false, status: "inbox", pinned: false, priority: "normal", lastFromMe: false, category: "other", lastMessageAt: "2026-01-01T00:00:00Z", ...over }) as Thread;

test("a queued reply follows the stored messages and a failed one is marked failed", () => {
  const stored = { a: [{ id: "m1" } as Message], b: [{ id: "m2" } as Message] };
  const pending: PendingSend[] = [
    { id: "o1", threadId: "a", body: "hi", createdAt: "t1", status: "queued" },
    { id: "o2", threadId: "c", body: "yo", createdAt: "t2", status: "failed", error: "no" },
  ];
  const out = withQueuedReplies(stored, pending);
  assert.deepEqual(out.get("a")?.map((m) => m.id), ["m1", "outbox:o1"]);
  assert.equal(out.get("a")?.[1].sendState, "queued"); // each outbox status keeps its own state, so a sent reply says Sent
  assert.equal(out.get("b"), stored.b);
  assert.equal(out.get("c")?.[0].sendState, "failed");
  assert.equal(out.get("c")?.[0].sendError, "no");
});

test("lists put pinned first, then newest first", () => {
  const list = listThreadsFor([
    thread({ id: "old", lastMessageAt: "2026-01-01T00:00:00Z" }),
    thread({ id: "new", lastMessageAt: "2026-02-01T00:00:00Z" }),
    thread({ id: "pin", pinned: true, lastMessageAt: "2025-01-01T00:00:00Z" }),
    thread({ id: "gone", status: "archived" }),
  ], "all:none");
  assert.deepEqual(list.map((t) => t.id), ["pin", "new", "old"]);
});

test("the Priority view keeps only urgent and important, urgent first", () => {
  const list = listThreadsFor([
    thread({ id: "n", priority: "normal" }),
    thread({ id: "i", priority: "important", lastMessageAt: "2026-03-01T00:00:00Z" }),
    thread({ id: "u", priority: "urgent", lastMessageAt: "2026-01-01T00:00:00Z" }),
  ], "priority:none");
  assert.deepEqual(list.map((t) => t.id), ["u", "i"]);
});

test("a snoozed conversation leaves every inbox view until its time passes, and the Snoozed view lists it soonest first", () => {
  const now = Date.parse("2026-11-18T12:00:00Z");
  const threads = [
    thread({ id: "plain" }),
    thread({ id: "later", snoozedUntil: "2026-11-19T08:00:00Z" }),
    thread({ id: "soon", snoozedUntil: "2026-11-18T18:00:00Z", priority: "urgent" }),
    thread({ id: "back", snoozedUntil: "2026-11-18T09:00:00Z" }),
  ];
  assert.deepEqual(listThreadsFor(threads, "all:none", now).map((t) => t.id).sort(), ["back", "plain"]);
  assert.deepEqual(listThreadsFor(threads, "priority:none", now), []);
  assert.deepEqual(listThreadsFor(threads, "snoozed:none", now).map((t) => t.id), ["soon", "later"]);
  // The same list once the clock passes the return times: all are back.
  assert.equal(listThreadsFor(threads, "all:none", Date.parse("2026-11-19T09:00:00Z")).length, 4);
  assert.deepEqual(listThreadsFor(threads, "snoozed:none", Date.parse("2026-11-19T09:00:00Z")), []);
});

test("the Deleted view holds nothing in the store, since trashed conversations are read when it opens", () => {
  assert.deepEqual(listThreadsFor([thread({ id: "a" }), thread({ id: "t", status: "trash" })], "deleted:none"), []);
});
