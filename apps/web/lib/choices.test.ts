// Tests for choices.ts: parsing the guided drafting options the AI offers, finding clashes with busy time, and picking
// free slots to suggest.

import { test } from "node:test";
import assert from "node:assert/strict";
import { clashes, freeSlots, otherTimeDecision, parseChoices, parsePlan, type Busy } from "./choices";

const OPTIONS = [
  { label: "Yes, Available", decision: "I am free then.", kind: "accept" },
  { label: "Not Available", decision: "I can't make it.", kind: "decline" },
];

test("parseChoices reads options, the asked time as local time and the length", () => {
  const got = parseChoices(JSON.stringify({ asked: "2026-10-29T15:00", minutes: 45, options: OPTIONS }));
  assert.equal(got?.options.length, 2);
  assert.equal(got?.asked?.getHours(), 15);
  assert.equal(got?.asked?.getDate(), 29);
  assert.equal(got?.minutes, 45);
});

test("parseChoices gives null for nothing to offer or unreadable data", () => {
  assert.equal(parseChoices(JSON.stringify({ options: [] })), null);
  assert.equal(parseChoices(JSON.stringify({ options: [OPTIONS[0], { label: "x", decision: "y", kind: "nope" }] })), null);
  assert.equal(parseChoices("not json"), null);
  assert.equal(parseChoices(null), null);
  assert.equal(parseChoices(JSON.stringify({ asked: "Thursday", options: OPTIONS }))?.asked, undefined);
});

const at = (d: number, h: number, m = 0) => new Date(2026, 9, d, h, m);
const event = (start: Date, end: Date, title = "Viewing", allDay = false): Busy => ({ title, startsAt: start.toISOString(), endsAt: end.toISOString(), allDay });

test("clashes finds timed events overlapping and ignores all-day ones", () => {
  const events = [event(at(29, 14, 30), at(29, 15, 30)), event(at(29, 0), at(30, 0), "Holiday", true), event(at(29, 16), at(29, 17))];
  assert.deepEqual(clashes(events, at(29, 15), at(29, 16)).map((e) => e.title), ["Viewing"]);
  assert.deepEqual(clashes(events, at(29, 9), at(29, 10)), []);
});

test("freeSlots skips busy hours and the past, two a day at most", () => {
  const events = [event(at(29, 8), at(29, 10))];
  const slots = freeSlots(events, at(29, 15), at(28, 12));
  assert.deepEqual(slots.map((s) => `${s.getDate()} ${s.getHours()}`), ["29 10", "29 11", "30 8"]);
  // Asked about a time already past: offers from now on.
  const later = freeSlots([], at(20, 9), at(29, 16, 10));
  assert.deepEqual(later.map((s) => `${s.getDate()} ${s.getHours()}`), ["29 17", "30 8", "30 9"]);
});

test("otherTimeDecision names the asked time when there is one", () => {
  assert.match(otherTimeDecision(at(30, 9), at(29, 15)), /^I am not free on .*29.*, but .*30.* works for me\.$/);
  assert.match(otherTimeDecision(at(30, 9)), /works for me\.$/);
});

test("parsePlan reads a trip over several days as all day, and a time as a timed event", () => {
  assert.deepEqual(parsePlan({ title: "Onrus Trip", start: "2026-11-13", end: "2026-11-15", place: "Onrus" }), { title: "Onrus Trip", day: "2026-11-13", endDay: "2026-11-15", place: "Onrus" });
  assert.deepEqual(parsePlan({ title: "Coffee", start: "2026-11-13T10:30", end: "2026-11-13T11:00", place: "" }), { title: "Coffee", day: "2026-11-13", time: "10:30", until: "11:00", place: "" });
  // An end on another day or before the start is left for New Event to choose.
  assert.equal(parsePlan({ title: "Coffee", start: "2026-11-13T10:30", end: "2026-11-14T11:00", place: "" })?.until, undefined);
  assert.equal(parsePlan({ title: "Trip", start: "2026-11-13", end: "2026-11-12", place: "" })?.endDay, undefined);
  assert.equal(parsePlan({ title: "", start: "2026-11-13" }), undefined);
  assert.equal(parsePlan({ title: "Trip", start: "soon" }), undefined);
  assert.equal(parseChoices(JSON.stringify({ options: OPTIONS, plan: { title: "Trip", start: "2026-11-13", end: "", place: "" } }))?.plan?.day, "2026-11-13");
});
