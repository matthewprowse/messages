// Tests for resync-plan.ts: how long a gap must be to fetch anything, and the clock that finds gaps (a late tick, a
// rejoin after a drop, the page coming back) and hands each to exactly one catch-up.

import { test } from "node:test";
import assert from "node:assert/strict";
import { CLOCK_MARGIN_MS, FULL_OVER_MS, RETRY_AFTER_MS, SKIP_UNDER_MS, changesSince, createCatchUpClock, resyncPlan } from "./resync-plan";

const T0 = Date.parse("2026-11-03T08:00:00Z");
const s = (n: number) => n * 1000;
const m = (n: number) => n * 60_000;

/** Ticks every 10 s from `from` up to (not past) `to`, as a page that is awake does; returns any gaps found. */
function tickThrough(clock: ReturnType<typeof createCatchUpClock>, from: number, to: number) {
  const gaps = [];
  for (let t = from + s(10); t <= to; t += s(10)) {
    const gap = clock.tick(t);
    if (gap) gaps.push(gap);
  }
  return gaps;
}

test("a blip is skipped, a short gap fetches what changed, a long one reloads everything", () => {
  assert.equal(resyncPlan(SKIP_UNDER_MS - 1), "skip");
  assert.equal(resyncPlan(SKIP_UNDER_MS), "delta");
  assert.equal(resyncPlan(FULL_OVER_MS), "delta");
  assert.equal(resyncPlan(FULL_OVER_MS + 1), "full");
  assert.equal(changesSince(T0), new Date(T0 - CLOCK_MARGIN_MS).toISOString());
});

test("an awake page with the socket up never finds a gap", () => {
  const clock = createCatchUpClock(T0);
  assert.deepEqual(tickThrough(clock, T0, T0 + m(30)), []);
  assert.equal(clock.resumed(T0 + m(30) + s(5)), null);
});

test("coming back after minutes away catches up at once, from the last tick before the page froze", () => {
  const clock = createCatchUpClock(T0);
  tickThrough(clock, T0, T0 + m(1));
  const gap = clock.resumed(T0 + m(6));
  assert.deepEqual(gap, { plan: "delta", downMs: m(5), since: changesSince(T0 + m(1)), from: T0 + m(1) });
  // The overdue tick that fires right after, and the socket rejoining once it notices it died, find nothing left.
  assert.equal(clock.tick(T0 + m(6) + s(1)), null);
  clock.dropped();
  assert.equal(clock.subscribed(T0 + m(6) + s(4)), null);
  assert.deepEqual(tickThrough(clock, T0 + m(6) + s(4), T0 + m(10)), []);
});

test("an hour away reloads everything", () => {
  const clock = createCatchUpClock(T0);
  assert.equal(clock.resumed(T0 + m(60))?.plan, "full");
});

test("coming back after a few seconds fetches nothing, and a drop in that time is still caught up by the rejoin", () => {
  const clock = createCatchUpClock(T0);
  clock.dropped();
  assert.equal(clock.resumed(T0 + s(20)), null);
  // The gap kept growing from the drop: the rejoin sees all of it.
  assert.deepEqual(clock.subscribed(T0 + s(45)), { plan: "delta", downMs: s(45), since: changesSince(T0), from: T0 });
});

test("a late tick after the computer slept claims the gap, so the page coming back after does not repeat it", () => {
  const clock = createCatchUpClock(T0);
  const gap = clock.tick(T0 + m(20));
  assert.equal(gap?.plan, "full");
  assert.equal(gap?.downMs, m(20));
  assert.equal(clock.resumed(T0 + m(20) + s(1)), null);
});

test("a drop is caught up once on rejoin, and ticks while down do not move the time it was last current", () => {
  const clock = createCatchUpClock(T0);
  clock.dropped();
  assert.deepEqual(tickThrough(clock, T0, T0 + m(2)), []);
  const gap = clock.subscribed(T0 + m(2) + s(5));
  assert.equal(gap?.from, T0);
  assert.equal(gap?.plan, "delta");
  assert.equal(clock.subscribed(T0 + m(2) + s(6)), null);
  assert.equal(clock.resumed(T0 + m(2) + s(7)), null);
});

test("coming back while the socket is still down catches up at once, and the rejoin only covers the time after", () => {
  const clock = createCatchUpClock(T0);
  clock.dropped();
  assert.equal(clock.resumed(T0 + m(5))?.from, T0);
  // Rejoining soon after is a blip; rejoining much later is its own, newer gap.
  assert.equal(clock.subscribed(T0 + m(5) + s(10)), null);
  clock.dropped();
  assert.equal(clock.subscribed(T0 + m(6) + s(10))?.from, T0 + m(5) + s(10));
});

test("a short drop that rejoins inside the blip window is let go, as before", () => {
  const clock = createCatchUpClock(T0);
  tickThrough(clock, T0, T0 + m(1));
  clock.dropped();
  assert.equal(clock.subscribed(T0 + m(1) + s(10)), null);
  assert.equal(clock.resumed(T0 + m(1) + s(35)), null);
});

test("a failed catch-up hands its gap back: coming back retries at once, the tick after a pause", () => {
  const clock = createCatchUpClock(T0);
  const gap = clock.resumed(T0 + m(5))!;
  clock.failed(gap, T0 + m(5) + s(1));
  // Ticks do not mark the store current while the gap is owed, and wait before trying again.
  assert.equal(clock.tick(T0 + m(5) + s(10)), null);
  const retried = clock.tick(T0 + m(5) + s(1) + RETRY_AFTER_MS);
  assert.equal(retried?.from, T0);
  assert.equal(retried?.since, gap.since);
  // Succeeded: nothing more is owed.
  assert.deepEqual(tickThrough(clock, T0 + m(5) + s(1) + RETRY_AFTER_MS, T0 + m(10)), []);

  const other = createCatchUpClock(T0);
  other.failed(other.resumed(T0 + m(5))!, T0 + m(5));
  assert.equal(other.resumed(T0 + m(5) + s(2))?.from, T0);
});

test("a failed catch-up while the socket is down is retried by the rejoin", () => {
  const clock = createCatchUpClock(T0);
  clock.dropped();
  const gap = clock.resumed(T0 + m(3))!;
  clock.failed(gap, T0 + m(3));
  assert.deepEqual(tickThrough(clock, T0 + m(3), T0 + m(4)), []);
  assert.equal(clock.subscribed(T0 + m(4))?.from, T0);
});

test("a failed older catch-up reaches back past a newer one claimed meanwhile", () => {
  const clock = createCatchUpClock(T0);
  const first = clock.resumed(T0 + m(5))!;
  clock.dropped();
  const second = clock.subscribed(T0 + m(6))!;
  assert.equal(second.from, T0 + m(5));
  clock.failed(first, T0 + m(6));
  assert.equal(clock.resumed(T0 + m(6) + s(1))?.from, T0);
});
