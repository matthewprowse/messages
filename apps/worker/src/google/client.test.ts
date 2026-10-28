// Tests for the retryDelay policy in google/client.ts: what is retried, how long to wait, and that sends are never retried after a server error.

import { test } from "node:test";
import assert from "node:assert/strict";
import { retryDelay } from "./client";

const failed = (status: number, method = "GET", extra: Partial<Parameters<typeof retryDelay>[0]> = {}) =>
  retryDelay({ status, reason: null, method, attempt: 0, retryAfter: null, ...extra });

test("reads are retried after a rate limit or a server error", () => {
  assert.notEqual(failed(429), null);
  assert.notEqual(failed(500), null);
  assert.notEqual(failed(503), null);
  assert.equal(failed(404), null);
  assert.equal(failed(400), null);
});

test("sends and changes are retried only after a rate limit", () => {
  assert.notEqual(failed(429, "POST"), null);
  assert.equal(failed(500, "POST"), null);
  assert.equal(failed(503, "POST"), null);
  assert.equal(failed(502, "PATCH"), null);
  assert.equal(failed(500, "DELETE"), null);
});

test("a 403 is retried only when Google says it is a rate limit", () => {
  assert.notEqual(failed(403, "POST", { reason: "userRateLimitExceeded" }), null);
  assert.equal(failed(403, "GET", { reason: "dailyLimitExceeded" }), null);
  assert.equal(failed(403, "GET", { reason: "insufficientPermissions" }), null);
});

test("the wait doubles each time, with some jitter, then gives up", () => {
  for (const [attempt, base] of [[0, 1_000], [1, 2_000], [2, 4_000]] as const) {
    const ms = failed(503, "GET", { attempt })!;
    assert.ok(ms >= base * 0.8 && ms <= base * 1.2, `attempt ${attempt}: ${ms}`);
  }
  assert.equal(failed(503, "GET", { attempt: 3 }), null);
});

test("Retry-After in seconds or as a date is honoured, up to a limit", () => {
  assert.equal(failed(429, "GET", { retryAfter: "3" }), 3_000);
  assert.equal(failed(429, "GET", { retryAfter: "0" }), 0);
  const now = Date.parse("2026-10-23T12:00:00Z");
  assert.equal(failed(429, "GET", { retryAfter: "Fri, 23 Oct 2026 12:00:05 GMT", now }), 5_000);
  assert.equal(failed(429, "GET", { retryAfter: "3600" }), 30_000);
});

test("an unreadable Retry-After falls back to the usual wait", () => {
  const ms = failed(429, "GET", { attempt: 1, retryAfter: "soon" })!;
  assert.ok(ms >= 1_600 && ms <= 2_400);
});
