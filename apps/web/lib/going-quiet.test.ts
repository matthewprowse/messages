// Tests for lib/going-quiet.ts: who counts as going quiet, in what order.

import test from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_QUIET_DAYS, goingQuiet, lastContactAt, quietDaysOf } from "./going-quiet";

const now = new Date(2026, 10, 12, 15, 0);
const daysAgo = (n: number) => new Date(2026, 10, 12 - n, 9).toISOString();
const person = (id: string, over: Record<string, unknown> = {}) => ({ id, hidden: false, isCompany: false, ...over });

test("the newest of the two directions is the last contact", () => {
  assert.equal(lastContactAt({ lastInboundAt: "2026-11-01T00:00:00Z", lastOutboundAt: "2026-11-05T00:00:00Z" }), "2026-11-05T00:00:00Z");
  assert.equal(lastContactAt({ lastInboundAt: null, lastOutboundAt: "2026-11-05T00:00:00Z" }), "2026-11-05T00:00:00Z");
  assert.equal(lastContactAt({}), null);
});

test("only starred people and clients appear, once they have been quiet for the chosen days", () => {
  const list = [
    person("vip", { vip: true, lastInboundAt: daysAgo(40) }),
    person("client", { relationship: "client", lastOutboundAt: daysAgo(31) }),
    person("recent", { vip: true, lastInboundAt: daysAgo(3) }),
    person("friend", { relationship: "Personal", lastInboundAt: daysAgo(90) }),
    person("nobody", { vip: true }),
  ];
  assert.deepEqual(goingQuiet(list, 30, now).map((c) => c.id), ["vip", "client"]);
  assert.deepEqual(goingQuiet(list, 60, now).map((c) => c.id), []);
  assert.deepEqual(goingQuiet(list, 2, now).map((c) => c.id), ["vip", "client", "recent"]);
});

test("the longest silence comes first, and hidden people and companies are left out", () => {
  const list = [
    person("a", { vip: true, lastInboundAt: daysAgo(35) }),
    person("b", { vip: true, lastInboundAt: daysAgo(80) }),
    person("hidden", { vip: true, hidden: true, lastInboundAt: daysAgo(80) }),
    person("company", { vip: true, isCompany: true, lastInboundAt: daysAgo(80) }),
  ];
  assert.deepEqual(goingQuiet(list, 30, now).map((c) => c.id), ["b", "a"]);
});

test("the days come from the URL only when they are one of the choices", () => {
  assert.equal(quietDaysOf("60"), 60);
  assert.equal(quietDaysOf("7"), DEFAULT_QUIET_DAYS);
  assert.equal(quietDaysOf(null), DEFAULT_QUIET_DAYS);
});
