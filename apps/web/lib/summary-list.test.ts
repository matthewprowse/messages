// Tests for summary-list.ts: Summary links and filters, which of today's events stay on the list, and J and K movement.

import { test } from "node:test";
import assert from "node:assert/strict";
import { filterOf, listHref, nextAfterDone, nextRowIndex, unfinishedEvents } from "./summary-list";
import type { CalendarEvent } from "./calendar";

const event = (id: string, startsAt: string, endsAt: string | null, allDay = false) => ({ id, startsAt, endsAt, allDay }) as CalendarEvent;

test("no filter links to the bare Summary path", () => {
  assert.equal(listHref("none"), "/summary");
  assert.equal(listHref("unread"), "/summary?filter=unread");
  assert.equal(filterOf("email"), "email");
  assert.equal(filterOf("waiting"), "none");
  assert.equal(filterOf(null), "none");
});

test("finished events drop out, all-day ones lead, and an event with no end lasts an hour", () => {
  const now = new Date("2026-03-01T10:30:00Z");
  const kept = unfinishedEvents(
    [
      event("done", "2026-03-01T08:00:00Z", "2026-03-01T09:00:00Z"),
      event("later", "2026-03-01T14:00:00Z", "2026-03-01T15:00:00Z"),
      event("noend-live", "2026-03-01T10:00:00Z", null),
      event("noend-over", "2026-03-01T09:00:00Z", null),
      event("allday", "2026-03-01", null, true),
      event("other-day", "2026-03-02T09:00:00Z", null),
    ],
    (e) => e.id !== "other-day",
    now,
  );
  assert.deepEqual(kept.map((e) => e.id), ["allday", "noend-live", "later"]);
});

test("J and K start from the focused row, else the open one, else the top, and stop at the ends", () => {
  assert.equal(nextRowIndex(0, -1, -1, 1), undefined);
  assert.equal(nextRowIndex(5, -1, -1, 1), 0);
  assert.equal(nextRowIndex(5, -1, 2, 1), 3);
  assert.equal(nextRowIndex(5, 1, 3, -1), 0);
  assert.equal(nextRowIndex(5, 4, -1, 1), 4);
  assert.equal(nextRowIndex(5, 0, -1, -1), 0);
});

test("changing the filter keeps the open conversation in the path", () => {
  assert.equal(listHref("email", "abc"), "/summary/abc?filter=email");
  assert.equal(listHref("none", "abc"), "/summary/abc");
  assert.equal(listHref("none", "a b/c"), "/summary/a%20b%2Fc");
});

test("after a conversation is done the next row down opens, else the one above, else nothing", () => {
  assert.equal(nextAfterDone(["a", "b", "c"], ["a", "c"], "b"), "c");
  assert.equal(nextAfterDone(["a", "b", "c"], ["a", "b"], "c"), "b");
  assert.equal(nextAfterDone(["a", "b", "c"], ["a", "c"], "a"), "c");
  assert.equal(nextAfterDone(["a"], [], "a"), undefined);
  assert.equal(nextAfterDone(["a", "b"], ["a", "b"], "z"), undefined);
});
