// Tests for summary.ts: which conversations land in each Summary section, the quiet-time cutoffs, and the digest line.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { attentionCount, digest, olderWaiting, summarise } from "./summary";
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

test("urgent comes before important, then newest first, and urgent fades to important after a day", () => {
  const s = summarise(
    [
      thread("important-new", { priority: "important", lastMessageAt: hoursAgo(1) }),
      thread("urgent-old", { priority: "urgent", lastMessageAt: hoursAgo(30) }),
      thread("urgent-new", { priority: "urgent", lastMessageAt: hoursAgo(2) }),
      thread("urgent-day", { priority: "urgent", lastMessageAt: hoursAgo(23) }),
    ],
    "none",
    now,
  );
  assert.deepEqual(ids(s.priority), ["urgent-new", "urgent-day", "important-new", "urgent-old"]);
});

test("old, bulk and unsummarised conversations stay out", () => {
  const s = summarise(
    [
      thread("stale-reply", { needsReply: true, lastMessageAt: hoursAgo(24 * 3 + 1) }),
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

test("the filter narrows every section, by any channel", () => {
  const threads = [thread("mail", { needsReply: true }), thread("chat", { needsReply: true, channel: "whatsapp" }), thread("dm", { needsReply: true, channel: "instagram" })];
  assert.deepEqual(ids(summarise(threads, "whatsapp", now).reply), ["chat"]);
  assert.deepEqual(ids(summarise(threads, "instagram", now).reply), ["dm"]);
});

test("a question about a time that has passed leaves Needs Reply for Older", () => {
  const threads = [
    thread("passed", { needsReply: true, askedAt: hoursAgo(2) }),
    thread("coming", { needsReply: true, askedAt: new Date(now.getTime() + 3_600_000).toISOString() }),
  ];
  assert.deepEqual(ids(summarise(threads, "none", now).reply), ["coming"]);
  assert.deepEqual(ids(olderWaiting(threads, "none", now)), ["passed"]);
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

test("the rail count is the page's Needs Reply plus Important, so old unanswered threads do not light it", () => {
  const threads = [
    thread("reply", { needsReply: true }),
    thread("urgent", { priority: "urgent" }),
    thread("stale-reply", { needsReply: true, lastMessageAt: hoursAgo(24 * 4) }),
    thread("bulk", { priority: "important", category: "newsletter" }),
    thread("update", { category: "fyi", summary: "FYI." }),
  ];
  assert.equal(attentionCount(threads, now), 2);
  assert.equal(attentionCount([thread("stale", { priority: "urgent", lastMessageAt: hoursAgo(24 * 9) })], now), 0);
});

test("old unanswered and old urgent conversations are listed as older, newest first, not dropped", () => {
  const threads = [
    thread("stale-reply", { needsReply: true, lastMessageAt: hoursAgo(24 * 4) }),
    thread("stale-urgent", { priority: "urgent", lastMessageAt: hoursAgo(24 * 8) }),
    thread("stale-important", { priority: "important", lastMessageAt: hoursAgo(24 * 8) }),
    thread("stale-newsletter", { priority: "urgent", category: "newsletter", lastMessageAt: hoursAgo(24 * 8) }),
    thread("answered", { needsReply: true, lastFromMe: true, lastMessageAt: hoursAgo(24 * 20) }),
    thread("shown", { needsReply: true }),
    thread("whatsapp", { needsReply: true, channel: "whatsapp", lastMessageAt: hoursAgo(24 * 20) }),
  ];
  assert.deepEqual(ids(olderWaiting(threads, "none", now)), ["stale-reply", "stale-urgent", "whatsapp"]);
  assert.deepEqual(ids(summarise([thread("three-days", { needsReply: true, lastMessageAt: hoursAgo(24 * 3) })], "none", now).reply), ["three-days"]);
  assert.deepEqual(ids(olderWaiting(threads, "whatsapp", now)), ["whatsapp"]);
});

test("a snoozed conversation is off the page until its time passes", () => {
  const later = new Date(now.getTime() + 3_600_000).toISOString();
  const earlier = new Date(now.getTime() - 3_600_000).toISOString();
  const threads = [
    thread("hidden", { needsReply: true, snoozedUntil: later, snoozeKind: "snooze" }),
    thread("back", { needsReply: true, snoozedUntil: earlier, snoozeKind: "snooze" }),
    thread("hidden-urgent", { priority: "urgent", snoozedUntil: later, snoozeKind: "snooze" }),
  ];
  assert.deepEqual(ids(summarise(threads, "none", now).reply), ["back"]);
  assert.deepEqual(ids(summarise(threads, "none", now).priority), []);
  assert.equal(attentionCount(threads, now), 1);
  assert.deepEqual(ids(olderWaiting([thread("old", { needsReply: true, lastMessageAt: hoursAgo(24 * 20), snoozedUntil: later })], "none", now)), []);
});

test("Waiting On Others lists what you wrote last and nobody answered for two days, quietest first", () => {
  const sent = (id: string, hours: number, patch: Partial<Thread> = {}) => thread(id, { lastFromMe: true, waiting: true, lastMessageAt: hoursAgo(hours), ...patch });
  const threads = [
    sent("three-days", 72),
    sent("five-days", 120),
    sent("yesterday", 24),
    sent("no-answer-expected", 100, { waiting: false }),
    sent("snoozed", 100, { snoozedUntil: new Date(now.getTime() + 3_600_000).toISOString() }),
    sent("junk", 100, { junk: true }),
    thread("they-wrote", { needsReply: true }),
  ];
  const s = summarise(threads, "waiting", now);
  assert.deepEqual(ids(s.waiting), ["five-days", "three-days"]);
  assert.deepEqual([s.reply, s.priority, s.updates], [[], [], []]);
  assert.equal(digest(s, 0), "2 Waiting on Others");
  assert.deepEqual(olderWaiting(threads, "waiting", now), []);
  assert.deepEqual(summarise(threads, "none", now).waiting, []);
});

// The same file is read by apps/ai/tests/test_brief.py, which pins the Python copy of these rules.
test("the shared fixture sorts into the expected sections", () => {
  const fixture = JSON.parse(readFileSync(new URL("./summary-fixture.json", import.meta.url), "utf8"));
  const threads = fixture.threads.map((r: Record<string, unknown> & { id: string; ageHours: number }) => thread(r.id, { ...r, lastMessageAt: hoursAgo(r.ageHours) } as Partial<Thread>));
  const s = summarise(threads, "none", now);
  assert.deepEqual({ reply: ids(s.reply), priority: ids(s.priority), updates: ids(s.updates) }, fixture.expected);
});
