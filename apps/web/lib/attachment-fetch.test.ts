// Tests for fetchDeferredFile (lib/attachment-fetch.ts) with fake calls and no waiting.

import { test } from "node:test";
import assert from "node:assert/strict";
import { fetchDeferredFile, FETCH_TEXT, isDeferredFile, type FetchApi, type FileCheck } from "./attachment-fetch";

const none: FileCheck = { path: null, sealed: false, notKept: "deferred", error: null };

function api(checks: FileCheck[], over: Partial<FetchApi> = {}) {
  const calls = { requests: [] as boolean[], checks: 0 };
  const a: FetchApi = {
    request: async (_id, again) => (calls.requests.push(again), true),
    check: async () => checks[Math.min(calls.checks++, checks.length - 1)],
    wait: async () => undefined,
    visible: () => true,
    ...over,
  };
  return { a, calls };
}

test("only an uncopied deferred file is fetched on open", () => {
  assert.equal(isDeferredFile({ notKept: "deferred" }), true);
  assert.equal(isDeferredFile({ notKept: "deferred", path: "u/m/a" }), false);
  assert.equal(isDeferredFile({ notKept: "over_cap" }), false);
  assert.equal(isDeferredFile({}), false);
});

test("asks once, then waits until the file has a path", async () => {
  const { a, calls } = api([none, none, { ...none, path: "u/m/a", sealed: true }]);
  assert.deepEqual(await fetchDeferredFile(a, "a1", false, () => false, 1), { kind: "ready", path: "u/m/a", sealed: true });
  assert.deepEqual(calls.requests, [false]);
  assert.equal(calls.checks, 3);
});

test("shows the worker's error, and says a vanished file cannot be retried", async () => {
  assert.deepEqual(await fetchDeferredFile(api([{ ...none, error: "Storage full" }]).a, "a1", false, () => false, 1), { kind: "error", message: "Storage full", retry: true });
  assert.deepEqual(await fetchDeferredFile(api([{ ...none, notKept: "unavailable" }]).a, "a1", false, () => false, 1), { kind: "error", message: FETCH_TEXT.gone, retry: false });
});

test("a request that cannot be made is a plain error with Retry", async () => {
  const { a } = api([none], { request: async () => false });
  assert.deepEqual(await fetchDeferredFile(a, "a1", false, () => false, 1), { kind: "error", message: FETCH_TEXT.cannotAsk, retry: true });
  const thrown = api([none], { request: async () => { throw new Error("offline"); } });
  assert.equal((await fetchDeferredFile(thrown.a, "a1", false, () => false, 1))?.kind, "error");
});

test("gives up after the limit, but a hidden tab does not use up the time", async () => {
  const slow = api([none]);
  assert.deepEqual(await fetchDeferredFile(slow.a, "a1", false, () => false, 10, 30), { kind: "error", message: FETCH_TEXT.slow, retry: true });
  assert.equal(slow.calls.checks, 4);
  let hiddenFor = 3;
  const tab = api([none], { visible: () => hiddenFor-- <= 0 });
  await fetchDeferredFile(tab.a, "a1", false, () => false, 10, 30);
  assert.equal(tab.calls.checks, 4);
});

test("retry asks again, and a stopped viewer ends quietly", async () => {
  const retry = api([{ ...none, path: "p", sealed: false }]);
  await fetchDeferredFile(retry.a, "a1", true, () => false, 1);
  assert.deepEqual(retry.calls.requests, [true]);
  assert.equal(await fetchDeferredFile(api([none]).a, "a1", false, () => true, 1), null);
});
