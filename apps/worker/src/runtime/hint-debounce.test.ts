// Tests for hint debouncing with a fake clock and fake timers.

import { test } from "node:test";
import assert from "node:assert/strict";
import { HintDebouncer, type Timers } from "./hint-debounce";

function rig(windowMs = 3_000) {
  let now = 100_000;
  const queue: { at: number; fn: () => void; live: boolean }[] = [];
  const timers: Timers = {
    set: (fn, ms) => { const t = { at: now + ms, fn, live: true }; queue.push(t); return t; },
    clear: (h) => { (h as { live: boolean }).live = false; },
  };
  const fired: string[] = [];
  const d = new HintDebouncer((id) => fired.push(id), windowMs, () => now, timers);
  const advance = (ms: number) => {
    now += ms;
    for (const t of queue) if (t.live && t.at <= now) { t.live = false; t.fn(); }
  };
  return { d, fired, advance };
}

test("the first hint fires at once", () => {
  const { d, fired } = rig();
  d.hint("a");
  assert.deepEqual(fired, ["a"]);
});

test("a burst inside the window becomes one more fire at its end", () => {
  const { d, fired, advance } = rig();
  d.hint("a");
  advance(500);
  for (let i = 0; i < 20; i++) d.hint("a");
  assert.deepEqual(fired, ["a"]);
  advance(2_499);
  assert.deepEqual(fired, ["a"]);
  advance(1);
  assert.deepEqual(fired, ["a", "a"]);
});

test("a hint after the window fires at once again", () => {
  const { d, fired, advance } = rig();
  d.hint("a");
  advance(3_000);
  d.hint("a");
  assert.equal(fired.length, 2);
});

test("accounts are debounced separately", () => {
  const { d, fired } = rig();
  d.hint("a");
  d.hint("b");
  assert.deepEqual(fired, ["a", "b"]);
});

test("a forgotten account does not fire its booked hint", () => {
  const { d, fired, advance } = rig();
  d.hint("a");
  d.hint("a");
  d.forget("a");
  advance(5_000);
  assert.deepEqual(fired, ["a"]);
});
