// Tests for summary.ts: which conversations land in each Summary section, the quiet-time cutoffs, and the digest line.

import { test } from "node:test";
import assert from "node:assert/strict";
import { digest, summarise } from "./summary";
import type { Thread } from "./types";

const now = new Date("2026-10-23T12:00:00Z");
const hoursAgo = (h: number) => new Date(now.getTime() - h * 3_600_000).toISOString();

function thread(id: string, patch: Partial<Thread> = {}): Thread {
  return {
    id,
    channel: "email",
    provider: "gmail",
    participantIds: [],
    lastMessageAt: hoursAgo(1),
    unread: false,
    unreadCount: 0,
    pinned: false,
    status: "inbox",
    priority: "normal",
    category: "personal",
    summary: "",
    needsReply: false,
    lastFromMe: false,
    junk: false,
    subscription: false,
    ...patch,
  };
}

const ids = (list: Thread[]) => list.map((t) => t.id);

test("each conversation lands in the first section that fits", () => {
  const s = summarise(
    [
      thread("reply", { needsReply: true, priority: "urgent" }),
      thread("urgent", { priority: "urgent" }),
      thread("update", { category: "fyi", summary: "Your parcel arrives Friday." }),
      thread("plain"),
    ],
    "none",
    now,
  );
  assert.deepEqual(ids(s.reply), ["reply"]);
  assert.deepEqual(ids(s.priority), ["urgent"]);
  assert.deepEqual(ids(s.updates), ["update"]);
});

test("junk, archived and deleted conversations are left out", () => {
  const s = summarise(
    [
      thread("junk", { needsReply: true, junk: true }),
      thread("archived", { needsReply: true, status: "archived" }),
      thread("trash", { priority: "urgent", status: "trash" }),
    ],
    "none",
    now,
  );
  assert.deepEqual([...s.reply, ...s.priority, ...s.updates], []);
});

test("urgent comes before important, then newest first", () => {
  const s = summarise(
    [
      thread("important-new", { priority: "important", lastMessageAt: hoursAgo(1) }),
      thread("urgent-old", { priority: "urgent", lastMessageAt: hoursAgo(30) }),
      thread("urgent-new", { priority: "urgent", lastMessageAt: hoursAgo(2) }),
    ],
    "none",
    now,
  );
  assert.deepEqual(ids(s.priority), ["urgent-new", "urgent-old", "important-new"]);
});

test("old, bulk and unsummarised conversations stay out", () => {
  const s = summarise(
    [
      thread("stale-reply", { needsReply: true, lastMessageAt: hoursAgo(24 * 15) }),
      thread("stale-urgent", { priority: "urgent", lastMessageAt: hoursAgo(24 * 8) }),
      thread("newsletter", { priority: "important", category: "newsletter" }),
      thread("no-summary", { category: "fyi" }),
      thread("old-update", { category: "work", summary: "Done.", lastMessageAt: hoursAgo(25) }),
    ],
    "none",
    now,
  );
  assert.deepEqual([...s.reply, ...s.priority, ...s.updates], []);
});

test("a needs-reply category without the flag is already answered", () => {
  const s = summarise([thread("answered", { category: "needs_reply" })], "none", now);
  assert.deepEqual(ids(s.reply), []);
});

test("a conversation you answered last is left out, whatever its priority", () => {
  const s = summarise(
    [
      thread("answered-urgent", { priority: "urgent", lastFromMe: true }),
      thread("answered-update", { category: "work", summary: "Signed and sent.", lastFromMe: true }),
      thread("answered-flagged", { needsReply: true, lastFromMe: true }),
    ],
    "none",
    now,
  );
  assert.deepEqual([...s.reply, ...s.priority, ...s.updates], []);
});

test("the filter narrows every section", () => {
  const s = summarise([thread("mail", { needsReply: true }), thread("chat", { needsReply: true, channel: "whatsapp" })], "whatsapp", now);
  assert.deepEqual(ids(s.reply), ["chat"]);
});

test("the digest counts what is there and skips what is not", () => {
  const s = summarise(
    [
      thread("a", { needsReply: true, priority: "urgent" }),
      thread("b", { needsReply: true }),
      thread("c", { priority: "urgent" }),
    ],
    "none",
    now,
  );
  assert.equal(digest(s, 1), "2 Need a Reply, 1 Urgent or Important, 1 Event Today");
  assert.equal(digest(summarise([], "none", now), 0), "");
  assert.equal(digest(summarise([], "none", now), 0, 2), "2 Tasks");
});
