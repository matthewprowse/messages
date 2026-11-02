// Tests for what a queued email does while its account is not connected.

import assert from "node:assert/strict";
import { test } from "node:test";
import { ACCOUNT_ERROR_WAIT_MS, accountVerdict } from "./account-wait";

const now = Date.parse("2026-11-02T10:00:00Z");
const ago = (ms: number) => new Date(now - ms).toISOString();

test("a connected or syncing account sends at once", () => {
  assert.equal(accountVerdict("connected", ago(0), now), "send");
  assert.equal(accountVerdict("syncing", ago(ACCOUNT_ERROR_WAIT_MS * 2), now), "send");
  assert.equal(accountVerdict(undefined, ago(0), now), "send");
});

test("an account in error holds the email for a while, then fails it", () => {
  assert.equal(accountVerdict("error", ago(60_000), now), "wait");
  assert.equal(accountVerdict("error", ago(ACCOUNT_ERROR_WAIT_MS - 1), now), "wait");
  assert.equal(accountVerdict("error", ago(ACCOUNT_ERROR_WAIT_MS), now), "fail");
});

test("a disconnected account fails at once, and an unreadable time does not wait forever", () => {
  assert.equal(accountVerdict("disconnected", ago(0), now), "fail");
  assert.equal(accountVerdict("error", "not a date", now), "fail");
});
