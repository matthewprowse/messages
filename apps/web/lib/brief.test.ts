import { test } from "node:test";
import assert from "node:assert/strict";
import { REFRESH_COOLDOWN_MS, REQUESTS_PER_DAY, cooldownWait, limitReached, nextRequestAt, requestsLeft, whenAllowed } from "./brief-pace";

const now = Date.parse("2026-10-25T12:00:00Z");
const ago = (h: number) => new Date(now - h * 3_600_000).toISOString();

test("nothing asked for leaves every request", () => {
  assert.equal(requestsLeft([], now), REQUESTS_PER_DAY);
  assert.equal(nextRequestAt([], now), null);
});

test("each request in the last 24 hours counts, the first brief of the day included", () => {
  assert.equal(requestsLeft([ago(1)], now), REQUESTS_PER_DAY - 1);
  assert.equal(requestsLeft([ago(1), ago(5)], now), REQUESTS_PER_DAY - 2);
  assert.equal(nextRequestAt([ago(1), ago(5)], now), null);
});

test("requests older than 24 hours no longer count", () => {
  assert.equal(requestsLeft([ago(25), ago(30), ago(2)], now), REQUESTS_PER_DAY - 1);
});

test("with none left the next is allowed when the oldest ages out", () => {
  const log = [ago(2), ago(10), ago(20)];
  assert.equal(requestsLeft(log, now), 0);
  assert.equal(nextRequestAt(log, now), now + 4 * 3_600_000);
  // Only the last 24 hours count, so an older request does not move it.
  assert.equal(nextRequestAt([ago(2), ago(10), ago(20), ago(40)], now), now + 4 * 3_600_000);
});

test("bad timestamps are ignored", () => {
  assert.equal(requestsLeft(["nonsense", ago(1)], now), REQUESTS_PER_DAY - 1);
});

test("the database's limit error is recognised and carries the next time", () => {
  const at = "2026-10-26T09:10:00Z";
  assert.deepEqual(limitReached({ code: "54000", message: "brief_request_limit", details: at }), { nextAt: new Date(at).toISOString() });
  assert.deepEqual(limitReached({ code: "54000", message: "brief_request_limit", details: null }), { nextAt: null });
  assert.equal(limitReached({ code: "42501", message: "brief_request_limit" }), null);
  assert.equal(limitReached({ code: "54000", message: "something else" }), null);
  assert.equal(limitReached(null), null);
});

test("the next time is said in plain words", () => {
  const today = new Date(2026, 9, 25, 12, 0).getTime();
  assert.match(whenAllowed(new Date(2026, 9, 25, 14, 5).getTime(), today), /^at \d{2}[:.]\d{2}$/);
  assert.match(whenAllowed(new Date(2026, 9, 26, 9, 10).getTime(), today), /^tomorrow at /);
  assert.match(whenAllowed(new Date(2026, 9, 28, 9, 10).getTime(), today), /^on \w+ at /);
});

test("the cooldown counts down from the last refresh", () => {
  assert.equal(cooldownWait(null, 1000), 0);
  assert.equal(cooldownWait(1000, 11_000), REFRESH_COOLDOWN_MS - 10_000);
  assert.equal(cooldownWait(1000, 1000 + REFRESH_COOLDOWN_MS), 0);
});
