// Tests for paging.ts: a first build, a later catch-up, resuming a build that was cut short, and the end of history.

import test from "node:test";
import assert from "node:assert/strict";
import { afterPage, NEW_SAVED, startPass, type Cursor, type PageInfo } from "./paging";

const at = (n: number): Cursor => ({ sentAt: `2026-01-${String(n).padStart(2, "0")}`, id: `m${n}` });
const full = (last: Cursor, allKnown = false): PageInfo => ({ last, size: 200, limit: 200, allKnown });
const short: PageInfo = { last: at(1), size: 40, limit: 200, allKnown: false };

test("a first build pages back, saving how far it got, until a short page", () => {
  let step = afterPage(startPass(NEW_SAVED), full(at(20)));
  assert.equal(step.finished, false);
  assert.deepEqual(step.pass.cursor, at(20));
  assert.deepEqual(step.pass.saved, { cursor: at(20), done: false });
  step = afterPage(step.pass, full(at(10)));
  assert.deepEqual(step.pass.saved, { cursor: at(10), done: false });
  step = afterPage(step.pass, short);
  assert.equal(step.finished, true);
  assert.equal(step.pass.saved.done, true);
});

test("a finished index stops at the first page it already holds", () => {
  const saved = { cursor: at(1), done: true };
  const withNew = afterPage(startPass(saved), full(at(30)));
  assert.equal(withNew.finished, false);
  assert.deepEqual(withNew.pass.saved, saved);
  assert.equal(afterPage(withNew.pass, full(at(25), true)).finished, true);
  assert.equal(afterPage(startPass(saved), full(at(30), true)).finished, true);
});

test("an index cut short catches up on the newest, then jumps to where it stopped and carries on", () => {
  const saved = { cursor: at(5), done: false };
  let step = afterPage(startPass(saved), full(at(28)));
  assert.equal(step.pass.phase, "catchup");
  step = afterPage(step.pass, full(at(22), true));
  assert.equal(step.finished, false);
  assert.equal(step.pass.phase, "backfill");
  assert.deepEqual(step.pass.cursor, at(5));
  step = afterPage(step.pass, full(at(3)));
  assert.deepEqual(step.pass.saved, { cursor: at(3), done: false });
  step = afterPage(step.pass, short);
  assert.equal(step.finished, true);
  assert.equal(step.pass.saved.done, true);
});

test("an empty first page ends the build", () => {
  const step = afterPage(startPass(), { last: null, size: 0, limit: 200, allKnown: true });
  assert.equal(step.finished, true);
  assert.equal(step.pass.saved.done, true);
});
