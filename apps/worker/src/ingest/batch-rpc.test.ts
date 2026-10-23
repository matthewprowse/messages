import assert from "node:assert/strict";
import { test } from "node:test";
import { BATCH_RECHECK_MS, BatchRpc, functionMissing, isFailure, type RpcResponse } from "./batch-rpc";

type Row = { n: number };
type Result = { result: "inserted"; n: number };

/** A BatchRpc over fakes, recording every call. `batch` answers each bulk call. */
function fake(batch: (rows: Row[]) => RpcResponse, opts: { size?: number; failOne?: number } = {}) {
  const calls: string[] = [];
  let clock = 0;
  const rpc = new BatchRpc<Row, Result>(
    "test_batch",
    opts.size ?? 3,
    async (_account, rows) => {
      calls.push(`many:${rows.map((r) => r.n).join(",")}`);
      return batch(rows);
    },
    async (_account, row) => {
      calls.push(`one:${row.n}`);
      if (row.n === opts.failOne) throw Object.assign(new Error("boom"), { code: "23505" });
      return { result: "inserted", n: row.n };
    },
    () => clock,
  );
  return { rpc, calls, advance: (ms: number) => (clock += ms) };
}

const rows = (...ns: number[]) => ns.map((n) => ({ n }));
const ok = (list: Row[]): RpcResponse => ({ data: list.map((r) => ({ result: "inserted", n: r.n })), error: null, status: 200 });
const missing = (): RpcResponse => ({ data: null, error: { code: "PGRST202" }, status: 404 });

test("stores in chunks of the given size, in order, and a lone row on its own", async () => {
  const { rpc, calls } = fake(ok);
  const out = await rpc.run("a", rows(1, 2, 3, 4, 5, 6, 7));
  assert.deepEqual(calls, ["many:1,2,3", "many:4,5,6", "one:7"]);
  assert.deepEqual(out.map((r) => (isFailure(r) ? "x" : r.n)), [1, 2, 3, 4, 5, 6, 7]);
});

test("falls back to one at a time while the batch function is missing, and looks again later", async () => {
  const { rpc, calls, advance } = fake(missing);
  const first = await rpc.run("a", rows(1, 2, 3, 4));
  assert.deepEqual(calls, ["many:1,2,3", "one:1", "one:2", "one:3", "one:4"]); // not asked again for the second chunk
  assert.equal(first.filter((r) => !isFailure(r)).length, 4);

  calls.length = 0;
  advance(BATCH_RECHECK_MS - 1);
  await rpc.run("a", rows(5, 6));
  assert.deepEqual(calls, ["one:5", "one:6"]);

  calls.length = 0;
  advance(1);
  await rpc.run("a", rows(7, 8));
  assert.deepEqual(calls, ["many:7,8", "one:7", "one:8"]);
});

test("a batch call that fails otherwise falls back for that chunk only", async () => {
  let failNext = true;
  const { rpc, calls } = fake((list) => {
    if (failNext) {
      failNext = false;
      return { data: null, error: { code: "57014" }, status: 500 };
    }
    return ok(list);
  });
  await rpc.run("a", rows(1, 2, 3, 4, 5, 6));
  assert.deepEqual(calls, ["many:1,2,3", "one:1", "one:2", "one:3", "many:4,5,6"]);
});

test("a batch answer of the wrong length is not trusted", async () => {
  const { rpc, calls } = fake(() => ({ data: [{ result: "inserted", n: 1 }], error: null, status: 200 }));
  const out = await rpc.run("a", rows(1, 2));
  assert.deepEqual(calls, ["many:1,2", "one:1", "one:2"]);
  assert.equal(out.length, 2);
});

test("a row that fails inside the batch comes back as a failure and the rest are kept", async () => {
  const { rpc } = fake((list) => ({
    data: list.map((r) => (r.n === 2 ? { result: "error", code: "23503" } : { result: "inserted", n: r.n })),
    error: null,
    status: 200,
  }));
  const out = await rpc.run("a", rows(1, 2, 3));
  assert.equal(isFailure(out[1]) && out[1].code, "23503");
  assert.deepEqual([out[0], out[2]], [{ result: "inserted", n: 1 }, { result: "inserted", n: 3 }]);
});

test("a row that fails one at a time comes back as a failure and the rest are still stored", async () => {
  const { rpc, calls } = fake(missing, { failOne: 2 });
  const out = await rpc.run("a", rows(1, 2, 3));
  assert.deepEqual(calls, ["many:1,2,3", "one:1", "one:2", "one:3"]);
  assert.equal(isFailure(out[1]) && out[1].code, "23505");
  assert.equal(out.filter((r) => !isFailure(r)).length, 2);
});

test("tells a missing function from other errors", () => {
  assert.equal(functionMissing({ error: { code: "PGRST202" }, status: 404 }), true);
  assert.equal(functionMissing({ error: { code: "" }, status: 404 }), true);
  assert.equal(functionMissing({ error: { code: "57014" }, status: 500 }), false);
  assert.equal(functionMissing({ error: null, status: 200 }), false);
});
