// Tests for todays-events-cache.ts: the cache is per person and day, and signing out empties it.

import { test } from "node:test";
import assert from "node:assert/strict";
import { cacheEvents, cachedEvents, clearTodaysEvents } from "./todays-events-cache";
import type { CalendarEvent } from "./calendar";

const events = [{ id: "e1" }] as CalendarEvent[];

test("events are only served back to the same person on the same day", () => {
  cacheEvents("u1", "2026-11-02", events);
  assert.equal(cachedEvents("u1", "2026-11-02"), events);
  assert.equal(cachedEvents("u2", "2026-11-02"), undefined);
  assert.equal(cachedEvents("u1", "2026-11-03"), undefined);
  assert.equal(cachedEvents(undefined, "2026-11-02"), undefined);
});

test("clearing on sign out leaves nothing behind", () => {
  cacheEvents("u1", "2026-11-02", events);
  clearTodaysEvents();
  assert.equal(cachedEvents("u1", "2026-11-02"), undefined);
});
