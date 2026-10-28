// Tests for the address indexer's schedule: a quick pass again while work remains, an hourly one when idle, and the
// partial index list that keeps the idle query free.

import { test } from "node:test";
import assert from "node:assert/strict";
process.env.SUPABASE_URL ??= "http://localhost";
process.env.SUPABASE_SERVICE_ROLE_KEY ??= "test";
const { BUSY_MS, IDLE_MS, INDEXES, runLoop } = await import("./address-indexer");

function harness(results: (number | Error)[]) {
  const timers: { fn: () => void; ms: number; live: boolean }[] = [];
  let calls = 0;
  const pass = async () => {
    const r = results[calls++] ?? 0;
    if (r instanceof Error) throw r;
    return r;
  };
  const after = (fn: () => void, ms: number) => {
    const t = { fn, ms, live: true };
    timers.push(t);
    return t;
  };
  const clear = (t: unknown) => { (t as { live: boolean }).live = false; };
  const flush = () => new Promise((r) => setImmediate(r));
  const fire = async () => {
    const t = [...timers].reverse().find((x) => x.live)!;
    t.live = false;
    t.fn();
    await flush();
  };
  const last = () => [...timers].reverse().find((x) => x.live)?.ms;
  return { pass, after, clear, flush, fire, last, calls: () => calls };
}

test("runs at startup, drains quickly while there is work, then goes idle for an hour", async () => {
  const h = harness([5, 2, 0]);
  runLoop(h.pass, h.after, h.clear);
  await h.flush();
  assert.equal(h.calls(), 1);
  assert.equal(h.last(), BUSY_MS);
  await h.fire();
  assert.equal(h.last(), BUSY_MS);
  await h.fire();
  assert.equal(h.calls(), 3);
  assert.equal(h.last(), IDLE_MS);
});

test("a failing pass waits the idle time", async () => {
  const h = harness([new Error("down")]);
  runLoop(h.pass, h.after, h.clear);
  await h.flush();
  assert.equal(h.last(), IDLE_MS);
});

test("poke brings the next pass forward and stop cancels it", async () => {
  const h = harness([0, 0]);
  const loop = runLoop(h.pass, h.after, h.clear);
  await h.flush();
  assert.equal(h.last(), IDLE_MS);
  loop.poke();
  assert.equal(h.last(), 0);
  await h.fire();
  assert.equal(h.calls(), 2);
  loop.stop();
  assert.equal(h.last(), undefined);
});

test("every table has a partial index name for its null column", () => {
  assert.equal(INDEXES.length, 8);
  assert.ok(INDEXES.some((i) => i.table === "messages" && i.column === "to_indexes"));
  assert.equal(new Set(INDEXES.map((i) => i.name)).size, 8);
});
