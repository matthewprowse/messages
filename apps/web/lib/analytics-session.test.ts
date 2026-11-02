// Tests for lib/analytics-session.ts: a session carries on within 30 minutes of the last event and starts again after,
// a damaged stored value is a new session, and a clock that went backwards does not keep a session alive.

import assert from "node:assert/strict";
import { test } from "node:test";
import { IDLE_MS, nextSession, parseSession } from "./analytics-session";

const make = () => "new-id";

test("a session carries on until 30 minutes pass with nothing recorded", () => {
  const stored = { id: "abc", at: 1_000 };
  assert.deepEqual(nextSession(stored, 1_000 + IDLE_MS - 1, make), { session: { id: "abc", at: 1_000 + IDLE_MS - 1 }, fresh: false });
  assert.deepEqual(nextSession(stored, 1_000 + IDLE_MS, make), { session: { id: "new-id", at: 1_000 + IDLE_MS }, fresh: true });
});

test("no stored session, or a clock that went backwards, starts a new one", () => {
  assert.equal(nextSession(null, 5, make).fresh, true);
  assert.equal(nextSession({ id: "abc", at: 100 }, 50, make).fresh, true);
});

test("a stored value that is damaged or not an id is ignored", () => {
  assert.equal(parseSession(null), null);
  assert.equal(parseSession("{nope"), null);
  assert.equal(parseSession(JSON.stringify({ id: "Has Spaces", at: 1 })), null);
  assert.deepEqual(parseSession(JSON.stringify({ id: "a1-b2", at: 7 })), { id: "a1-b2", at: 7 });
});
