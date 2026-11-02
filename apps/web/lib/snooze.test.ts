// Tests for snooze.ts: the times the menus offer, when a conversation is hidden, and the marks it wears on its way back.

import assert from "node:assert/strict";
import { test } from "node:test";
import { isSnoozed, nextReturn, pickedDay, reminderChoices, returnText, snoozeChoices, snoozeMark, tomorrowMorning } from "./snooze";

const local = (y: number, m: number, d: number, h = 0) => new Date(y, m - 1, d, h, 0, 0, 0);
const keys = (now: Date) => snoozeChoices(now).map((c) => c.key);

test("on a weekday morning every choice is offered, at the right times", () => {
  const wed = local(2026, 11, 18, 9);
  assert.deepEqual(keys(wed), ["later", "tomorrow", "weekend", "week"]);
  const by = Object.fromEntries(snoozeChoices(wed).map((c) => [c.key, c.at]));
  assert.deepEqual(by.later, local(2026, 11, 18, 18));
  assert.deepEqual(by.tomorrow, local(2026, 11, 19, 8));
  assert.deepEqual(by.weekend, local(2026, 11, 21, 8)); // Saturday
  assert.deepEqual(by.week, local(2026, 11, 23, 8)); // Monday
});

test("late in the day Later Today is left out, and on a weekend This Weekend is", () => {
  assert.equal(keys(local(2026, 11, 18, 16)).includes("later"), false);
  assert.equal(keys(local(2026, 11, 21, 9)).includes("weekend"), false); // Saturday
  assert.equal(keys(local(2026, 11, 22, 9)).includes("weekend"), false); // Sunday
});

test("Next Week is the coming Monday, a whole week on when today is Monday, and tomorrow on a Sunday", () => {
  const week = (d: Date) => snoozeChoices(d).find((c) => c.key === "week")!.at;
  assert.deepEqual(week(local(2026, 11, 16, 9)), local(2026, 11, 23, 8)); // Monday
  assert.deepEqual(week(local(2026, 11, 22, 9)), local(2026, 11, 23, 8)); // Sunday
});

test("reminders wait 1, 3 or 7 days and come back at 08:00", () => {
  const got = reminderChoices(local(2026, 11, 18, 14));
  assert.deepEqual(got.map((c) => c.label), ["In 1 Day", "In 3 Days", "In 7 Days"]);
  assert.deepEqual(got[2].at, local(2026, 11, 25, 8));
  assert.deepEqual(tomorrowMorning(local(2026, 11, 30, 23)), local(2026, 12, 1, 8));
});

test("a picked day returns at 08:00, and today at the next full hour", () => {
  const now = local(2026, 11, 18, 10);
  assert.deepEqual(pickedDay(local(2026, 11, 25), now), local(2026, 11, 25, 8));
  assert.deepEqual(pickedDay(local(2026, 11, 18), now), local(2026, 11, 18, 11));
});

test("a conversation is hidden only while its time is ahead", () => {
  const now = Date.parse("2026-11-18T12:00:00Z");
  assert.equal(isSnoozed({ snoozedUntil: "2026-11-18T13:00:00Z" }, now), true);
  assert.equal(isSnoozed({ snoozedUntil: "2026-11-18T11:00:00Z" }, now), false);
  assert.equal(isSnoozed({}, now), false);
});

test("a returned snooze says Snoozed for a day, a returned reminder says Follow Up until answered", () => {
  const now = Date.parse("2026-11-18T12:00:00Z");
  const hoursAgo = (h: number) => new Date(now - h * 3_600_000).toISOString();
  assert.equal(snoozeMark({ snoozedUntil: hoursAgo(2), snoozeKind: "snooze", lastFromMe: false }, now), "snoozed");
  assert.equal(snoozeMark({ snoozedUntil: hoursAgo(30), snoozeKind: "snooze", lastFromMe: false }, now), null);
  assert.equal(snoozeMark({ snoozedUntil: hoursAgo(-2), snoozeKind: "snooze", lastFromMe: false }, now), null); // still snoozed
  assert.equal(snoozeMark({ snoozedUntil: hoursAgo(50), snoozeKind: "reminder", lastFromMe: true }, now), "follow_up");
  assert.equal(snoozeMark({ snoozedUntil: hoursAgo(50), snoozeKind: "reminder", lastFromMe: false }, now), "follow_up"); // a promise of theirs that passed its day
  assert.equal(snoozeMark({ snoozedUntil: hoursAgo(24 * 8), snoozeKind: "reminder", lastFromMe: true }, now), null);
});

test("the next return is the soonest time still ahead", () => {
  const now = Date.parse("2026-11-18T12:00:00Z");
  assert.equal(nextReturn([{ snoozedUntil: "2026-11-18T14:00:00Z" }, { snoozedUntil: "2026-11-18T13:00:00Z" }, { snoozedUntil: "2026-11-18T09:00:00Z" }, {}], now), Date.parse("2026-11-18T13:00:00Z"));
  assert.equal(nextReturn([{}, { snoozedUntil: "2026-11-18T09:00:00Z" }], now), undefined);
});

test("the return time reads as Today, Tomorrow or a date", () => {
  const now = local(2026, 11, 18, 9);
  assert.equal(returnText(local(2026, 11, 18, 18).toISOString(), now), "Today, 18:00");
  assert.equal(returnText(local(2026, 11, 19, 8).toISOString(), now), "Tomorrow, 08:00");
  assert.match(returnText(local(2026, 11, 23, 8).toISOString(), now), /23 Nov, 08:00$/);
});
