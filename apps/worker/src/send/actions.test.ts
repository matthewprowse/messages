// Tests for send/actions.ts against a fake database client: the atomic claim, the ownership check, the throw safety net and
// the not-ready requeue.

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

const row = { id: "a1", action: "trash", status: "working", thread_id: "t", user_id: "u" };
const thread = { id: "t", user_id: "u" };

test("claiming updates a queued row to working and only if it is still queued", async () => {
  const queries = fake(() => row);
  assert.equal((await actions.claimAction("a1"))?.id, "a1");
  assert.deepEqual(queries[0].payload, { status: "working" });
  assert.deepEqual(queries[0].filters, [["eq", "id", "a1"], ["eq", "status", "queued"]]);
});

test("a row someone else claimed is not applied", async () => {
  fake(() => null);
  let applied = 0;
  await actions.applyClaimed("a1", async () => void applied++, thread);
  assert.equal(applied, 0);
});

test("a claimed row is applied once", async () => {
  fake(() => row);
  let applied = 0;
  await actions.applyClaimed("a1", async () => void applied++, thread);
  assert.equal(applied, 1);
});

test("an apply that throws leaves the row failed, not working", async () => {
  const queries = fake(() => row);
  await assert.rejects(() => actions.applyClaimed("a1", async () => { throw new Error("boom"); }, thread), /boom/);
  const settle = queries.at(-1)!;
  assert.equal((settle.payload as { status: string }).status, "failed");
  assert.equal(typeof (settle.payload as { error: string }).error, "string");
});

test("a connector that is not ready puts the row back to queued without failing it", async () => {
  const queries = fake(() => row);
  await actions.applyClaimed("a1", async () => { throw new actions.NotReady(); }, thread);
  const settle = queries.at(-1)!;
  assert.deepEqual(settle.payload, { status: "queued" });
  assert.deepEqual(settle.filters, [["eq", "id", "a1"], ["eq", "status", "working"]]);
});

test("an action on someone else's conversation is failed and never applied", async () => {
  for (const other of [{ id: "t", user_id: "someone else" }, { id: "another thread", user_id: "u" }, null]) {
    const queries = fake(() => row);
    let applied = 0;
    await actions.applyClaimed("a1", async () => void applied++, other);
    assert.equal(applied, 0);
    assert.equal((queries.at(-1)!.payload as { status: string }).status, "failed");
  }
  assert.equal(actions.actionOwned(row, thread), true);
});
