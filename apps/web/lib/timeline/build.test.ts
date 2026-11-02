// lib/timeline/build.ts and items.ts: the merge is newest first, unloaded history is held back, the filters combine, and days group.

import assert from "node:assert/strict";
import { test } from "node:test";
import { countByType, dayLabel, filterTimeline, groupByDay, localDay, mergeNewestFirst, oldestMessage, visibleWindow } from "./build";
import { documentItem, leadItem, messageItem, promiseItem, squeeze, taskItem } from "./items";
import type { TimelineItem } from "./types";

const item = (key: string, type: TimelineItem["type"], at: string, over: Partial<TimelineItem> = {}): TimelineItem => ({ key, type, at, title: key, refs: [], ...over });

test("sources merge newest first, ties broken by key", () => {
  const out = mergeNewestFirst([[item("b", "message", "2026-11-01T10:00:00Z")], [item("a", "meeting", "2026-11-01T10:00:00Z"), item("c", "note", "2026-11-02T08:00:00Z")]]);
  assert.deepEqual(out.map((i) => i.key), ["c", "a", "b"]);
});

test("while older messages are unloaded, anything older than the oldest loaded message waits", () => {
  const all = mergeNewestFirst([[item("m1", "message", "2026-11-05T10:00:00Z"), item("m2", "message", "2026-11-03T10:00:00Z")], [item("meet", "meeting", "2026-10-01T10:00:00Z"), item("note", "note", "2026-11-04T10:00:00Z")]]);
  assert.equal(oldestMessage(all), "2026-11-03T10:00:00Z");
  assert.deepEqual(visibleWindow(all, false).map((i) => i.key), ["m1", "note", "m2"]);
  assert.deepEqual(visibleWindow(all, true).map((i) => i.key), ["m1", "note", "m2", "meet"]);
});

test("with no messages at all, everything shows", () => {
  const all = [item("n", "note", "2026-11-04T10:00:00Z")];
  assert.deepEqual(visibleWindow(all, false), all);
});

test("type, search and matter filters all have to pass", () => {
  const items = [
    item("a", "message", "2026-11-03T10:00:00Z", { title: "Quote for the roof", refs: ["thread:t1"] }),
    item("b", "message", "2026-11-02T10:00:00Z", { title: "Hello", detail: "the roof again", refs: ["thread:t2"] }),
    item("c", "note", "2026-11-01T10:00:00Z", { title: "Roof visit", refs: ["note:n1"] }),
  ];
  const none = new Set<never>();
  assert.equal(filterTimeline(items, { types: none, term: "" }).length, 3);
  assert.deepEqual(filterTimeline(items, { types: new Set(["message"]), term: "" }).map((i) => i.key), ["a", "b"]);
  assert.deepEqual(filterTimeline(items, { types: none, term: "  ROOF " }).map((i) => i.key), ["a", "b", "c"]);
  assert.deepEqual(filterTimeline(items, { types: none, term: "hello" }).map((i) => i.key), ["b"]);
  assert.deepEqual(filterTimeline(items, { types: none, term: "roof", matterRefs: new Set(["thread:t1", "note:n1"]) }).map((i) => i.key), ["a", "c"]);
  assert.deepEqual(filterTimeline(items, { types: none, term: "", matterRefs: new Set() }), []);
});

test("counts per type", () => {
  const c = countByType([item("a", "message", "x"), item("b", "message", "x"), item("c", "lead", "x")]);
  assert.equal(c.get("message"), 2);
  assert.equal(c.get("lead"), 1);
  assert.equal(c.get("task"), undefined);
});

test("days group in order with Today and Yesterday named", () => {
  const now = new Date(2026, 10, 5, 12, 0, 0);
  const at = (d: number, h: number) => new Date(2026, 10, d, h, 0, 0).toISOString();
  const groups = groupByDay([item("a", "note", at(5, 9)), item("b", "note", at(5, 8)), item("c", "note", at(4, 20)), item("d", "note", at(1, 10))], now);
  assert.deepEqual(groups.map((g) => [g.label, g.items.length]), [["Today", 2], ["Yesterday", 1], ["Sun 1 Nov", 1]]);
  assert.equal(localDay(at(5, 9)), "2026-11-05");
  assert.match(dayLabel("2025-03-02", now), /2025/);
});

test("a message is titled by its subject or its channel, voice notes by their kind", () => {
  const base = { id: "1", threadId: "t", sentAt: "2026-11-01T10:00:00Z", outgoing: false, preview: "  Hi   there ", subject: " Roof ", voice: false };
  assert.equal(messageItem({ ...base, channel: "email" }).title, "Roof");
  assert.equal(messageItem({ ...base, channel: "email", subject: "" }).title, "No Subject");
  assert.equal(messageItem({ ...base, channel: "whatsapp" }).title, "WhatsApp Message");
  assert.equal(messageItem({ ...base, channel: "whatsapp", voice: true, outgoing: true }).title, "You: Voice Note");
  assert.equal(messageItem({ ...base, channel: "email" }).detail, "Hi there");
  assert.deepEqual(messageItem({ ...base, channel: "email" }).refs, ["thread:t"]);
  assert.equal(squeeze("x".repeat(500), 10).length, 12);
});

test("promises, tasks, documents and leads map with their links and matter refs", () => {
  const now = new Date(2026, 10, 5);
  const p = promiseItem({ id: "p", threadId: "t", messageId: "m", owner: "me", text: "send the quote", dueOn: "2026-11-05", status: "open", snoozedUntil: null, createdAt: "2026-11-01T10:00:00Z" }, now);
  assert.equal(p.title, "You Promised: send the quote");
  assert.equal(p.detail, "Due Today");
  assert.equal(taskItem({ id: "k", accountId: "a", title: "Call", dueAt: null, dueAllDay: false, completed: false } as never), null);
  assert.equal(taskItem({ id: "k", accountId: "a", title: "Call", dueAt: "2026-11-06T08:00:00Z", dueAllDay: false, completed: true } as never)?.detail, "Done");
  const d = documentItem({ id: "f", name: "quote.pdf", sentAt: "2026-11-02T10:00:00Z", threadId: "t" }, { type: "quote", counterparty: "Roofers", amount: 4500, currency: "ZAR", due: null, reference: "Q1", summary: "Roof repairs" });
  assert.equal(d.title, "Quote: quote.pdf");
  assert.deepEqual(d.refs, ["attachment:f", "thread:t"]);
  assert.match(d.detail ?? "", /Roofers/);
  const l = leadItem({ id: "r", createdAt: "2026-11-01T10:00:00Z", threadId: "t", templateKey: "property24", undone: false });
  assert.equal(l.title, "Lead Captured From Property24");
  assert.equal(leadItem({ id: "r", createdAt: "x", threadId: null, templateKey: null, undone: true }).refs.length, 0);
});
