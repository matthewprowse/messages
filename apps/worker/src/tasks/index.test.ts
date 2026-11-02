// Tests for tasks/index.ts against a fake database client that records queries: settling ticks, claiming, restart
// recovery, superseded ticks and batched upserts.

import assert from "node:assert/strict";
import { test } from "node:test";
import type { TaskUpdateRow } from "./rows";

// The helpers that write to the database, against a fake client that records each query. The worker's env
// is filled in first, as importing the database client reads it; nothing here reaches a network.
process.env.SUPABASE_URL ??= "http://127.0.0.1:1";
process.env.SUPABASE_SERVICE_ROLE_KEY ??= "test";
process.env.ENCRYPTION_KEY ??= "test";
// Encryption is on unless "false"; these tests read the plain rows.
process.env.ENCRYPT_CONTENT = "false";

const { db } = await import("../db");
const tasks = await import("./index");

interface Query {
  table: string;
  op: "select" | "update" | "upsert";
  payload?: unknown;
  options?: unknown;
  filters: [string, string, unknown][];
}

/** Points the client at a fake: each query is recorded and answered by `answer`. */
function fake(answer: (q: Query) => unknown = () => []) {
  const queries: Query[] = [];
  const from = (table: string) => {
    const q: Query = { table, op: "select", filters: [] };
    const chain = {
      select: () => chain,
      update: (payload: unknown) => ((q.op = "update"), (q.payload = payload), chain),
      upsert: (payload: unknown, options: unknown) => ((q.op = "upsert"), (q.payload = payload), (q.options = options), chain),
      eq: (column: string, value: unknown) => (q.filters.push(["eq", column, value]), chain),
      in: (column: string, value: unknown) => (q.filters.push(["in", column, value]), chain),
      order: () => chain,
      limit: () => chain,
      maybeSingle: () => chain,
      then: (resolve: (r: unknown) => unknown, reject: (e: unknown) => unknown) => {
        queries.push(q);
        return Promise.resolve({ data: answer(q), error: null }).then(resolve, reject);
      },
    };
    return chain;
  };
  Object.assign(db, { from, rpc: () => Promise.resolve({ data: null, error: null }) });
  return queries;
}

const filter = (q: Query, column: string) => q.filters.find(([, c]) => c === column)?.[2];

function row(patch: Partial<TaskUpdateRow> = {}): TaskUpdateRow {
  return { id: "up1", user_id: "u", task_id: "t1", action: "complete", status: "updating", error: null, created_at: "2026-10-26T08:00:00Z", account_id: null, contact_id: null, linked_at: null, title: null, notes: null, due_at: null, due_all_day: false, priority: null, ...patch };
}

test("a tick the provider took writes the task's status, then settles the row as done", async () => {
  const queries = fake((q) => (q.table === "task_updates" && q.op === "select" ? { status: "updating" } : []));
  await tasks.finishTaskUpdate(row(), {}, "google_tasks");
  const [, task, settle] = queries;
  assert.equal(task.table, "tasks");
  assert.equal((task.payload as { status: string }).status, "completed");
  assert.equal(typeof (task.payload as { completed_at: string }).completed_at, "string");
  assert.deepEqual([filter(task, "id"), filter(task, "user_id")], ["t1", "u"]);
  assert.equal(settle.table, "task_updates");
  assert.deepEqual(settle.payload, { status: "done", error: null });
  assert.equal(filter(settle, "status"), "updating");
});

test("an untick that went through reopens the task", async () => {
  const queries = fake((q) => (q.op === "select" ? { status: "updating" } : []));
  await tasks.finishTaskUpdate(row({ action: "reopen" }));
  assert.deepEqual(queries[1].payload, { status: "open", completed_at: null });
});

test("a failed tick is settled with its reason and leaves the task alone", async () => {
  const queries = fake((q) => (q.op === "select" ? { status: "updating" } : []));
  await tasks.finishTaskUpdate(row(), { error: "Google Tasks could not be reached. Try again." }, "google_tasks");
  assert.equal(queries.some((q) => q.table === "tasks"), false);
  const settle = queries[1];
  assert.deepEqual(settle.payload, { status: "failed", error: "Google Tasks could not be reached. Try again." });
  assert.deepEqual(filter(settle, "status"), ["queued", "updating"]);
});

test("finishing a row that is already settled does nothing", async () => {
  const queries = fake((q) => (q.op === "select" ? { status: "done" } : []));
  await tasks.finishTaskUpdate(row());
  assert.equal(queries.length, 1);
});

test("a claim succeeds only for a row still queued", async () => {
  let queries = fake(() => [{ id: "up1" }]);
  assert.equal(await tasks.claimTaskUpdate("up1"), true);
  assert.deepEqual(queries[0].payload, { status: "updating" });
  assert.equal(filter(queries[0], "status"), "queued");
  queries = fake(() => []);
  assert.equal(await tasks.claimTaskUpdate("up1"), false);
});

test("ticks cut off by a restart are failed, not made again", async () => {
  const queries = fake();
  await tasks.failInterruptedTaskUpdates();
  assert.deepEqual(queries[0].payload, { status: "failed", error: tasks.INTERRUPTED });
  assert.equal(filter(queries[0], "status"), "updating");
});

test("superseded ticks are settled without asking the provider, and an empty list costs no query", async () => {
  let queries = fake();
  await tasks.supersedeTaskUpdates([row({ id: "a", status: "queued" }), row({ id: "b", status: "queued" })]);
  assert.deepEqual(queries[0].payload, { status: "done", error: null });
  assert.deepEqual(filter(queries[0], "id"), ["a", "b"]);
  queries = fake();
  await tasks.supersedeTaskUpdates([]);
  assert.equal(queries.length, 0);
});

test("tasks are upserted on their provider id, in batches, with and without contacts kept apart", async () => {
  const queries = fake();
  const rows = Array.from({ length: 250 }, (_, i) => ({ provider_task_id: `p${i}`, list_id: "l", title: `Task ${i}`, ...(i < 3 ? { contact_id: "c1" } : {}) }));
  assert.equal(await tasks.upsertTasks({ id: "a", user_id: "u" }, rows), 250);
  assert.deepEqual(queries.map((q) => (q.payload as unknown[]).length), [3, 200, 47]);
  for (const q of queries) {
    assert.equal(q.table, "tasks");
    assert.deepEqual(q.options, { onConflict: "account_id,provider_task_id" });
  }
  const first = (queries[1].payload as { user_id: string; account_id: string; title: string; contact_id?: string }[])[0];
  assert.deepEqual([first.user_id, first.account_id, first.title, "contact_id" in first], ["u", "a", "Task 3", false]);
});
