// Tests for first-load.ts: with no copy a failed first load is passed on as before; with the copy on screen it is kept,
// said once, and retried with growing pauses (or at once when woken) until it lands, merging against the state then.

import test from "node:test";
import assert from "node:assert/strict";
import { type FirstLoadDeps, loadOverCopy, retryDelayMs } from "./first-load";

/** Fakes: load answers from a script, sleep records pauses and returns at once (or is woken by hand). */
function fakes(results: ("fail" | string)[], opts: { showing?: boolean; holdSleep?: boolean } = {}) {
  const pauses: number[] = [];
  let kept = 0;
  let calls = 0;
  let now = "base-0";
  const woken: (() => void)[] = [];
  const deps: FirstLoadDeps<string, string> = {
    load: async () => {
      const r = results[Math.min(calls++, results.length - 1)];
      now = `base-${calls}`;
      if (r === "fail") throw new Error("offline");
      return r;
    },
    firstBase: () => "copy-base",
    baseNow: () => now,
    showingCopy: () => opts.showing ?? true,
    onKept: () => { kept++; },
    sleep: (ms, done) => { pauses.push(ms); if (opts.holdSleep) woken.push(done); else queueMicrotask(done); return () => undefined; },
  };
  return { deps, pauses, woken, kept: () => kept, calls: () => calls };
}

test("pauses double from two seconds and stop growing at a minute", () => {
  assert.deepEqual([1, 2, 3, 4, 5, 6, 7, 10].map(retryDelayMs), [2000, 4000, 8000, 16000, 32000, 60000, 60000, 60000]);
});

test("a first load that lands at once merges against the copy's base", async () => {
  const f = fakes(["data"]);
  assert.deepEqual(await loadOverCopy(f.deps).landed, { data: "data", base: "copy-base" });
  assert.equal(f.kept(), 0);
});

test("with no copy on screen a failure is passed on at once, as before", async () => {
  const f = fakes(["fail", "data"], { showing: false });
  await assert.rejects(loadOverCopy(f.deps).landed, /offline/);
  assert.equal(f.calls(), 1);
  assert.equal(f.kept(), 0);
});

test("with the copy on screen it is kept, said once, and the full load is tried again until it lands", async () => {
  const f = fakes(["fail", "fail", "fail", "data"]);
  const out = await loadOverCopy(f.deps).landed;
  assert.equal(out.data, "data");
  assert.equal(out.base, "base-3", "a retry merges against the state when it began, which holds the copy");
  assert.deepEqual(f.pauses, [2000, 4000, 8000]);
  assert.equal(f.kept(), 1);
});

test("being woken (back online, app shown) tries again at once, and cancelling stops the tries", async () => {
  const f = fakes(["fail", "data"], { holdSleep: true });
  const run = loadOverCopy(f.deps);
  while (f.woken.length === 0) await new Promise((r) => setImmediate(r));
  f.woken[0]();
  assert.equal((await run.landed).data, "data");

  const g = fakes(["fail"], { holdSleep: true });
  const stopped = loadOverCopy(g.deps);
  while (g.woken.length === 0) await new Promise((r) => setImmediate(r));
  stopped.cancel();
  await assert.rejects(stopped.landed, /cancelled/);
  assert.equal(g.calls(), 1);
});
