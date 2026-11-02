// Tests for mail-action-failures.ts: a failed archive or read is reported with the worker's reason, in plain words.

import { test } from "node:test";
import assert from "node:assert/strict";
import { failureText, stillOpen } from "./mail-action-failures";

test("nothing failed gives no message", () => {
  assert.equal(failureText([{ action: "archive", status: "done", error: null }]), null);
});

test("a failed archive names the action and the reason", () => {
  assert.equal(
    failureText([{ action: "archive", status: "failed", error: "Gmail refused the change." }]),
    "Archiving did not reach your mail provider. Gmail refused the change.",
  );
});

test("several failures are counted and a missing reason gets a default", () => {
  const text = failureText([
    { action: "trash", status: "failed", error: null },
    { action: "trash", status: "failed", error: null },
    { action: "read", status: "done", error: null },
  ]);
  assert.equal(text, "Deleting did not reach your mail provider (and 1 more). It will match on the next change.");
});

test("queued and working actions are still open, finished ones are not", () => {
  assert.ok(stillOpen([{ action: "read", status: "working", error: null }]));
  assert.ok(stillOpen([{ action: "read", status: "queued", error: null }, { action: "read", status: "done", error: null }]));
  assert.ok(!stillOpen([{ action: "read", status: "failed", error: null }]));
});
