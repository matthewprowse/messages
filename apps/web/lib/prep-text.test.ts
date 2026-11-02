// Tests for prep-text.ts: the brief JSON is read defensively, and the Refresh allowance resets each UTC day.

import { test } from "node:test";
import assert from "node:assert/strict";
import { parsePrep, refreshPending, refreshesLeft, REFRESH_CAP } from "./prep-text";

test("a brief's people are read, with missing parts empty", () => {
  const people = parsePrep(JSON.stringify({ v: 1, people: [{ contact_id: "c1", name: "Sam", who: "Office Manager", recent: ["Lease (Email, today)", 4], promises: [], last_meeting: null, asked: "Lease by Friday" }] }));
  assert.deepEqual(people, [{ contactId: "c1", name: "Sam", who: "Office Manager", recent: ["Lease (Email, today)"], promises: [], lastMeeting: null, asked: "Lease by Friday" }]);
});

test("unreadable briefs show nothing", () => {
  assert.deepEqual(parsePrep(null), []);
  assert.deepEqual(parsePrep("not json"), []);
  assert.deepEqual(parsePrep('{"people": "x"}'), []);
  assert.deepEqual(parsePrep('{"people": [{"who": "no name"}, 3]}'), []);
});

test("refreshes reset on a new day", () => {
  const now = new Date("2026-11-20T10:00:00Z");
  assert.equal(refreshesLeft(null, now), REFRESH_CAP);
  assert.equal(refreshesLeft({ refresh_day: "2026-11-20", refresh_count: 2 }, now), 1);
  assert.equal(refreshesLeft({ refresh_day: "2026-11-20", refresh_count: 5 }, now), 0);
  assert.equal(refreshesLeft({ refresh_day: "2026-11-19", refresh_count: 3 }, now), REFRESH_CAP);
});

test("a refresh is pending until the card is newer than the ask", () => {
  assert.equal(refreshPending(null), false);
  assert.equal(refreshPending({ requested_at: "2026-11-20T10:00:00Z", updated_at: null }), true);
  assert.equal(refreshPending({ requested_at: "2026-11-20T10:00:00Z", updated_at: "2026-11-20T09:00:00Z" }), true);
  assert.equal(refreshPending({ requested_at: "2026-11-20T10:00:00Z", updated_at: "2026-11-20T10:01:00Z" }), false);
});
