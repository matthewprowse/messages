// send-rails.ts: the gaps and typing time stay inside their bounds, the caps hold and lift on a rolling day, a bad
// environment value never switches a limit off, and the Pacer spaces messages with a fake clock.

import assert from "node:assert/strict";
import { test } from "node:test";
import { checkLimits, DEFAULT_RAILS, nextGapMs, Pacer, partGapMs, railsFromEnv, typingMs, type RecentSend } from "./send-rails";

const R = DEFAULT_RAILS;
const DAY = 24 * 60 * 60_000;

test("the defaults are 300 a day and 20 to new people", () => {
  assert.equal(R.dailyCap, 300);
  assert.equal(R.newChatCap, 20);
});

test("the environment overrides the defaults, and a bad cap keeps the safe default", () => {
  const r = railsFromEnv({ WHATSAPP_DAILY_CAP: "100", WHATSAPP_NEW_CHAT_CAP: "0", WHATSAPP_MIN_GAP_SECONDS: "10", WHATSAPP_PART_GAP_SECONDS: "abc" });
  assert.equal(r.dailyCap, 100);
  assert.equal(r.newChatCap, 20);
  assert.equal(r.minGapMs, 10_000);
  assert.equal(r.partGapMs, R.partGapMs);
  assert.equal(railsFromEnv({}).dailyCap, 300);
  assert.equal(railsFromEnv({ WHATSAPP_MIN_GAP_SECONDS: "0" }).minGapMs, 0);
});

test("the gap between messages is the minimum plus jitter, never less", () => {
  assert.equal(nextGapMs(R, 0), R.minGapMs);
  assert.ok(nextGapMs(R, 0.999) < R.minGapMs + R.gapJitterMs);
  assert.equal(partGapMs(R, 0), R.partGapMs);
});

test("typing time grows with the text and stays between the minimum and the maximum", () => {
  assert.equal(typingMs(R, 0, 0.5), 0);
  assert.equal(typingMs(R, 3, 0.5), R.typingMinMs);
  assert.equal(typingMs(R, 100_000, 0.5), R.typingMaxMs);
  const short = typingMs(R, 60, 0.5);
  const long = typingMs(R, 120, 0.5);
  assert.ok(long > short && short >= R.typingMinMs && long <= R.typingMaxMs);
});

const sends = (n: number, at: number, cold = false): RecentSend[] => Array.from({ length: n }, (_, i) => ({ at: at + i, cold }));

test("under both caps a message may go", () => {
  assert.deepEqual(checkLimits(sends(299, 1_000_000), false, R, 2_000_000), { ok: true });
});

test("the daily cap holds, and lifts when the oldest send that counts is a day old", () => {
  const now = 10 * DAY;
  const recent = [...sends(1, now - 5_000), ...sends(299, now - 1_000)];
  const v = checkLimits(recent, false, R, now);
  assert.equal(v.ok, false);
  if (!v.ok) {
    assert.equal(v.reason, "daily_limit");
    assert.equal(v.retryAt, now - 5_000 + DAY);
  }
});

test("sends older than a day do not count", () => {
  const now = 10 * DAY;
  assert.deepEqual(checkLimits(sends(400, now - DAY - 10_000), false, R, now), { ok: true });
});

test("the new chat cap applies only to a message to someone never chatted with", () => {
  const now = 10 * DAY;
  const recent = sends(20, now - 60_000, true);
  assert.deepEqual(checkLimits(recent, false, R, now), { ok: true });
  const v = checkLimits(recent, true, R, now);
  assert.equal(v.ok, false);
  if (!v.ok) assert.equal(v.reason, "new_chat_limit");
});

test("when both limits bite, the later time wins under the daily reason", () => {
  const now = 10 * DAY;
  const cold = sends(20, now - 1_000, true);
  const warm = sends(280, now - 90_000);
  const v = checkLimits([...cold, ...warm], true, R, now);
  assert.equal(v.ok, false);
  if (!v.ok) {
    assert.equal(v.reason, "daily_limit");
    assert.ok(v.retryAt >= now - 1_000 + DAY);
  }
});

test("the pacer makes the second message wait out the gap, then lets it go", () => {
  let now = 1_000;
  const p = new Pacer(R, () => now, () => 0);
  assert.equal(p.waitMs(), 0);
  p.markSent();
  assert.equal(p.waitMs(), R.minGapMs);
  now += 4_000;
  assert.equal(p.waitMs(), R.minGapMs - 4_000);
  now += 10_000;
  assert.equal(p.waitMs(), 0);
});

test("jitter makes two gaps differ", () => {
  const values = [0.1, 0.9];
  let i = 0;
  const p = new Pacer(R, () => 0, () => values[i++ % 2]);
  p.markSent();
  const a = p.waitMs();
  p.markSent();
  assert.notEqual(a, p.waitMs());
});
