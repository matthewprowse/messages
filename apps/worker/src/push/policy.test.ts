// Tests for push/policy.ts and push/plan.ts: which conversations notify, quiet hours (including past midnight and other
// time zones), and what is settled without a push.

import test from "node:test";
import assert from "node:assert/strict";
import { allowedNow, inQuietHours, isNewMessage, pushKind, type PushSettings, type PushThread } from "./policy";
import { planPushes, type Candidate } from "./plan";

const NOW = new Date("2026-11-02T10:00:00Z");
const settings: PushSettings = { pushUrgent: true, pushImportant: true, quietStart: "22:00:00", quietEnd: "07:30:00", timezone: "UTC" };
const thread = (over: Partial<PushThread> = {}): PushThread => ({
  priority: "urgent", lastFromMe: false, unreadCount: 1, status: "inbox", junk: false, lastMessageAt: "2026-11-02T09:55:00Z", pushNotifiedAt: null, ...over,
});
const cand = (id: string, user: string, over: Partial<PushThread> = {}): Candidate => ({ id, userId: user, ...thread(over) });

test("only unread Urgent and Important inbox messages from others can notify", () => {
  assert.equal(pushKind(thread()), "urgent");
  assert.equal(pushKind(thread({ priority: "important" })), "important");
  assert.equal(pushKind(thread({ priority: "normal" })), null);
  assert.equal(pushKind(thread({ priority: null })), null);
  assert.equal(pushKind(thread({ lastFromMe: true })), null);
  assert.equal(pushKind(thread({ unreadCount: 0 })), null);
  assert.equal(pushKind(thread({ junk: true })), null);
  assert.equal(pushKind(thread({ status: "archived" })), null);
});

test("a message is new once, and only while it is fresh", () => {
  assert.equal(isNewMessage(thread(), NOW), true);
  assert.equal(isNewMessage(thread({ pushNotifiedAt: "2026-11-02T09:55:00Z" }), NOW), false);
  assert.equal(isNewMessage(thread({ pushNotifiedAt: "2026-11-02T09:00:00Z" }), NOW), true);
  assert.equal(isNewMessage(thread({ lastMessageAt: "2026-11-02T08:00:00Z" }), NOW), false);
  assert.equal(isNewMessage(thread({ lastMessageAt: null }), NOW), false);
});

test("quiet hours that pass midnight cover the night, not the day", () => {
  assert.equal(inQuietHours(new Date("2026-11-02T23:00:00Z"), settings), true);
  assert.equal(inQuietHours(new Date("2026-11-02T03:00:00Z"), settings), true);
  assert.equal(inQuietHours(new Date("2026-11-02T07:29:00Z"), settings), true);
  assert.equal(inQuietHours(new Date("2026-11-02T07:30:00Z"), settings), false);
  assert.equal(inQuietHours(new Date("2026-11-02T15:00:00Z"), settings), false);
});

test("quiet hours inside one day, equal times and bad times", () => {
  const day = { ...settings, quietStart: "13:00", quietEnd: "14:00" };
  assert.equal(inQuietHours(new Date("2026-11-02T13:30:00Z"), day), true);
  assert.equal(inQuietHours(new Date("2026-11-02T14:00:00Z"), day), false);
  assert.equal(inQuietHours(NOW, { ...settings, quietStart: "08:00", quietEnd: "08:00" }), false);
  assert.equal(inQuietHours(NOW, { ...settings, quietStart: "late", quietEnd: "07:30" }), false);
});

test("quiet hours are read in the person's own time zone", () => {
  // 20:30 UTC is 22:30 in Johannesburg (UTC+2): quiet there, awake in UTC.
  const at = new Date("2026-11-02T20:30:00Z");
  assert.equal(inQuietHours(at, { ...settings, timezone: "Africa/Johannesburg" }), true);
  assert.equal(inQuietHours(at, settings), false);
  assert.equal(inQuietHours(at, { ...settings, timezone: "Not/AZone" }), false, "an unknown zone falls back to UTC");
});

test("Urgent ignores quiet hours, Important respects them, and each switch counts", () => {
  const night = new Date("2026-11-02T23:00:00Z");
  assert.equal(allowedNow("urgent", settings, night), true);
  assert.equal(allowedNow("important", settings, night), false);
  assert.equal(allowedNow("important", settings, NOW), true);
  assert.equal(allowedNow("urgent", { ...settings, pushUrgent: false }, night), false);
  assert.equal(allowedNow("important", { ...settings, pushImportant: false }, NOW), false);
});

test("the plan sends what is allowed and settles the rest without sending", () => {
  const night = new Date("2026-11-02T23:00:00Z");
  const fresh = (iso: string) => ({ lastMessageAt: iso, pushNotifiedAt: null });
  const at = "2026-11-02T22:55:00Z";
  const plan = planPushes(
    [cand("a", "u1", { ...fresh(at) }), cand("b", "u1", { priority: "important", ...fresh(at) }), cand("c", "u2", { ...fresh(at) }), cand("d", "u1", { priority: "normal", ...fresh(at) })],
    new Map([["u1", settings]]),
    night,
  );
  assert.deepEqual(plan.send.map((s) => [s.thread.id, s.kind]), [["a", "urgent"]]);
  assert.deepEqual(plan.settle.map((t) => t.id).sort(), ["b", "c"], "quiet-hours Important and a person with no settings are settled");
});
