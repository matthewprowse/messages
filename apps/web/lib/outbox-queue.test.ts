// Tests for outbox-queue.ts: what Undo and Send Now report for each answer the database can give.

import assert from "node:assert/strict";
import { test } from "node:test";
import { cancelOutbox, sendOutboxNow } from "./outbox-queue";

const answer = (data: boolean | null, error: unknown = null) => () => Promise.resolve({ data, error });

test("a cancelled row reports true, and one the worker already took reports false", async () => {
  assert.equal(await cancelOutbox("a", answer(true)), true);
  assert.equal(await cancelOutbox("a", answer(false)), false);
});

test("a failed or lost answer is not known, never a false cancel", async () => {
  assert.equal(await cancelOutbox("a", answer(null, { code: "500" })), null);
  assert.equal(await cancelOutbox("a", () => Promise.reject(new Error("offline"))), null);
});

test("Send Now reports the same three answers and names the right function", async () => {
  const seen: string[] = [];
  const rpc = (fn: string) => { seen.push(fn); return Promise.resolve({ data: true as boolean | null, error: null }); };
  assert.equal(await sendOutboxNow("a", rpc as never), true);
  assert.deepEqual(seen, ["send_outbox_now"]);
  assert.equal(await sendOutboxNow("a", answer(false)), false);
  assert.equal(await sendOutboxNow("a", answer(null, "x")), null);
});
