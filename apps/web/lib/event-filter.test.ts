// Tests for event-filter.ts: which calendar events stay visible for a search, including series that match.

import assert from "node:assert/strict";
import { test } from "node:test";
import { visibleEvents } from "./event-filter";

const events = [
  { id: "1", title: "Standup", seriesId: "s" },
  { id: "2", title: "Lunch", location: "Cafe Roma", seriesId: "s" },
  { id: "3", title: "Review", description: "Q3 standup notes" },
];

test("the search filters when nothing is hidden", () => {
  assert.deepEqual(visibleEvents(events, "standup", []).map((e) => e.id), ["1", "3"]);
  assert.deepEqual(visibleEvents(events, "roma", []).map((e) => e.id), ["2"]);
  assert.equal(visibleEvents(events, "", []).length, 3);
});

test("the search and hidden events combine", () => {
  assert.deepEqual(visibleEvents(events, "standup", [{ id: "1" }]).map((e) => e.id), ["3"]);
  assert.deepEqual(visibleEvents(events, "", [{ id: "x", scope: "series", seriesId: "s" }]).map((e) => e.id), ["3"]);
});
