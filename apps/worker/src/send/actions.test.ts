// Tests for send/actions.ts against a fake database client: the atomic claim, the throw safety net and recovery of 'working' rows.

import assert from "node:assert/strict";
import { test } from "node:test";

process.env.SUPABASE_URL ??= "http://127.0.0.1:1";
process.env.SUPABASE_SERVICE_ROLE_KEY ??= "test";
process.env.ENCRYPTION_KEY ??= "test";

const { db } = await import("../db");
const actions = await import("./actions");

interface Query {
  op: "select" | "update";
  payload?: unknown;
  filters: [string, string, unknown][];
}

function fake(answer: (q: Query) => unknown) {
  const queries: Query[] = [];
  const from = () => {
    const q: Query = { op: "select", filters: [] };
    const chain = {
      select: () => chain,
      update: (payload: unknown) => ((q.op = "update"), (q.payload = payload), chain),
      eq: (c: string, v: unknown) => (q.filters.push(["eq", c, v]), chain),
      lt: (c: string, v: unknown) => (q.filters.push(["lt", c, v]), chain),
      in: (c: string, v: unknown) => (q.filters.push(["in", c, v]), chain),
      limit: () => chain,
      maybeSingle: () => chain,
      then: (resolve: (r: unknown) => unknown, reject: (e: unknown) => unknown) => {
        queries.push(q);
        return Promise.resolve({ data: answer(q), error: null }).then(resolve, reject);
      },
    };
    return chain;
  };
  Object.assign(db, { from });
  return queries;
}

const row = { id: "a1", action: "trash", status: "working", thread_id: "t" };

test("claiming updates a queued row to working and only if it is still queued", async () => {
  const queries = fake(() => row);
  assert.equal((await actions.claimAction("a1"))?.id, "a1");
  assert.deepEqual(queries[0].payload, { status: "working" });
  assert.deepEqual(queries[0].filters, [["eq", "id", "a1"], ["eq", "status", "queued"]]);
});

test("a row someone else claimed is not applied", async () => {
  fake(() => null);
  let applied = 0;
  await actions.applyClaimed("a1", async () => void applied++);
  assert.equal(applied, 0);
});

test("a claimed row is applied once", async () => {
  fake(() => row);
  let applied = 0;
  await actions.applyClaimed("a1", async () => void applied++);
  assert.equal(applied, 1);
});

test("an apply that throws leaves the row failed, not working", async () => {
  const queries = fake(() => row);
  await assert.rejects(() => actions.applyClaimed("a1", async () => { throw new Error("boom"); }), /boom/);
  const settle = queries.at(-1)!;
  assert.equal((settle.payload as { status: string }).status, "failed");
  assert.equal(typeof (settle.payload as { error: string }).error, "string");
});

test("recovery queues working rows again, except ones this worker is still applying", async () => {
  const queries = fake((q) => (q.op === "select" ? [{ id: "a1" }, { id: "a2" }] : []));
  await actions.requeueWorking(new Date("2026-10-28T10:00:00Z"), new Set(["a2"]));
  assert.deepEqual(queries[0].filters, [["eq", "status", "working"], ["lt", "created_at", "2026-10-28T10:00:00.000Z"]]);
  assert.deepEqual(queries[1].payload, { status: "queued" });
  assert.deepEqual(queries[1].filters, [["eq", "status", "working"], ["in", "id", ["a1"]]]);
});

test("recovery at startup has no age limit and writes nothing when no row is working", async () => {
  const queries = fake(() => []);
  await actions.requeueWorking();
  assert.equal(queries.length, 1);
  assert.deepEqual(queries[0].filters, [["eq", "status", "working"]]);
});
