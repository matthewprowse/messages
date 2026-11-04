// Tests for all-rows.ts: every row comes back in order however the pages arrive, later pages are asked for together,
// and errors are thrown just as reading one page at a time would throw them.

import { test } from "node:test";
import assert from "node:assert/strict";
import { allRows } from "./all-rows";

type Result = { data: number[] | null; error: { code: string } | null };

/** A fake table of `total` rows. `delay` picks how long each page takes (ms); `fail` makes a page fail. */
function fakeTable(total: number, opts: { delay?: (from: number) => number; fail?: (from: number) => boolean } = {}) {
  const asked: number[] = [];
  let inFlight = 0, most = 0;
  const page = async (from: number, to: number): Promise<Result> => {
    asked.push(from);
    inFlight++;
    most = Math.max(most, inFlight);
    await new Promise((r) => setTimeout(r, opts.delay?.(from) ?? 1));
    inFlight--;
    if (opts.fail?.(from)) return { data: null, error: { code: "57014" } };
    const rows: number[] = [];
    for (let i = from; i <= Math.min(to, total - 1); i++) rows.push(i);
    return { data: rows, error: null };
  };
  return { page, asked, most: () => most };
}

const upTo = (n: number) => Array.from({ length: n }, (_, i) => i);

test("a query that fits in one page is asked for once", async () => {
  const t = fakeTable(42);
  assert.deepEqual(await allRows("Load things", t.page), upTo(42));
  assert.deepEqual(t.asked, [0]);
});

test("after a full first page the next pages are asked for together, and the rows stay in order", async () => {
  // Later pages land first, so order comes from the page, not from when it arrived.
  const t = fakeTable(2500, { delay: (from) => 20 - from / 1000 });
  assert.deepEqual(await allRows("Load things", t.page), upTo(2500));
  assert.deepEqual(t.asked, [0, 1000, 2000, 3000]);
  assert.equal(t.most(), 3);
});

test("exactly a page of rows ends on the empty page after it", async () => {
  const t = fakeTable(1000);
  assert.deepEqual(await allRows("Load things", t.page), upTo(1000));
  assert.deepEqual(t.asked, [0, 1000, 2000, 3000]);
});

test("a long query keeps asking a few pages at a time until one is short", async () => {
  const t = fakeTable(7200);
  assert.deepEqual(await allRows("Load things", t.page), upTo(7200));
  assert.deepEqual(t.asked, [0, 1000, 2000, 3000, 4000, 5000, 6000, 7000, 8000, 9000]);
});

test("the first failed page before the end throws with the label and code", async () => {
  const t = fakeTable(5000, { fail: (from) => from === 2000 || from === 3000 });
  await assert.rejects(allRows("Load contacts", t.page), { message: "Load contacts failed (57014)" });
});

test("a failed page past the end is ignored, as one page at a time would never have asked for it", async () => {
  const t = fakeTable(1500, { fail: (from) => from >= 2000 });
  assert.deepEqual(await allRows("Load contacts", t.page), upTo(1500));
});

test("a page that rejects past the end leaves no unhandled rejection, and one before the end rejects the read", async () => {
  const rows = (from: number) => ({ data: upTo(from === 0 ? 1000 : 10), error: null });
  const late = (from: number) => (from >= 2000 ? Promise.reject(new Error("offline")) : Promise.resolve(rows(from)));
  assert.equal((await allRows("Load things", late)).length, 1010);
  const early = (from: number) => (from === 1000 ? Promise.reject(new Error("offline")) : Promise.resolve(rows(from)));
  await assert.rejects(allRows("Load things", early), /offline/);
});
