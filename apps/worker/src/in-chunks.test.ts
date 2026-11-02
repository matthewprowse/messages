// Tests for in-chunks.ts: long id lists are cut into short requests, merged oldest first, and a failure throws its code.

import { test } from "node:test";
import assert from "node:assert/strict";
import { IN_CHUNK, readByIds, readQueued } from "./in-chunks";

const ids = Array.from({ length: 2000 }, (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`);

test("2,000 ids are read in slices no longer than the chunk size", async () => {
  const sizes: number[] = [];
  const rows = await readByIds(ids, async (slice) => { sizes.push(slice.length); return { data: slice.map((id) => ({ id })), error: null }; }, "load");
  assert.equal(rows.length, 2000);
  assert.ok(sizes.every((n) => n <= IN_CHUNK));
  assert.equal(sizes.length, 20);
});

test("queued rows from every slice are merged oldest first and cut to the window", async () => {
  let call = 0;
  const rows = await readQueued(ids, async () => { call++; return { data: [{ created_at: `2026-01-${String(30 - call).padStart(2, "0")}` }, { created_at: `2026-02-${String(call).padStart(2, "0")}` }], error: null }; }, "load", 5);
  assert.equal(rows.length, 5);
  assert.deepEqual(rows.map((r) => r.created_at), [...rows.map((r) => r.created_at)].sort());
  assert.equal(rows[0].created_at, "2026-01-10");
});

test("a failed slice throws with the database code and no content", async () => {
  await assert.rejects(readQueued(ids, async () => ({ data: null, error: { code: "414" } }), "load outbox", 50), (err: Error & { code?: string }) => err.code === "414" && err.message === "load outbox failed");
});

test("no ids reads nothing", async () => {
  assert.deepEqual(await readQueued([], async () => { throw new Error("no"); }, "x", 50), []);
});
