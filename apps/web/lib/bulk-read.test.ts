// Tests for bulk-read.ts: parsing the readable version, when it is offered, and asking for it with fake calls and no waiting.

import { test } from "node:test";
import assert from "node:assert/strict";
import { BULK_TEXT, canRead, linkHost, loadBulkRead, parseBulkRead, type BulkApi, type ReadableBulk } from "./bulk-read";

const READ: ReadableBulk = { summary: "A winter sale starts Friday.", points: ["Up to 40% off"], links: [{ label: "View the Sale", url: "https://shop.example.com/sale", host: "shop.example.com" }] };

test("parseBulkRead reads the summary, points and web links", () => {
  assert.deepEqual(parseBulkRead(JSON.stringify(READ)), READ);
});

test("parseBulkRead drops links that are not web addresses and unusable items", () => {
  const got = parseBulkRead(JSON.stringify({ summary: "S", points: ["a", 3, ""], links: [{ label: "x", url: "javascript:alert(1)" }, { label: "y", url: "https://ok.example.com" }, { label: "", url: "https://no.example.com" }] }));
  assert.deepEqual(got, { summary: "S", points: ["a"], links: [{ label: "y", url: "https://ok.example.com", host: "ok.example.com" }] });
});

test("a link's host is read from its address, never from what the AI wrote beside it", () => {
  const got = parseBulkRead(JSON.stringify({ summary: "S", links: [{ label: "Your Bank", url: "https://www.evil.example/login", host: "bank.example" }, { label: "Bad", url: "https://" }] }));
  assert.deepEqual(got?.links, [{ label: "Your Bank", url: "https://www.evil.example/login", host: "evil.example" }]);
  assert.equal(linkHost("https://user:pw@bank.example.evil.example/x"), "bank.example.evil.example");
  assert.equal(linkHost("javascript:alert(1)"), null);
});

test("parseBulkRead gives null for nothing, no summary or unreadable data", () => {
  assert.equal(parseBulkRead(null), null);
  assert.equal(parseBulkRead("not json"), null);
  assert.equal(parseBulkRead(JSON.stringify({ summary: " ", points: [] })), null);
});

test("only bulk email that is not shortened and not WhatsApp is offered a readable version", () => {
  assert.equal(canRead({ bulk: true }), true);
  assert.equal(canRead({ bulk: true, bodyShrunk: true }), false);
  assert.equal(canRead({ bulk: true, whatsapp: true }), false);
  assert.equal(canRead({}), false);
});

function api(over: Partial<BulkApi> & { reads?: (ReadableBulk | null)[]; failures?: (string | null)[] } = {}) {
  const calls = { requests: [] as boolean[], stored: 0, failure: 0 };
  const { reads = [null], failures = [null], ...rest } = over;
  const a: BulkApi = {
    stored: async () => reads[Math.min(calls.stored++, reads.length - 1)],
    request: async (_id, again) => (calls.requests.push(again), true),
    failure: async () => failures[Math.min(calls.failure++, failures.length - 1)],
    wait: async () => undefined,
    visible: () => true,
    ...rest,
  };
  return { a, calls };
}

test("a stored version is shown at once without asking", async () => {
  const { a, calls } = api({ reads: [READ] });
  assert.deepEqual(await loadBulkRead(a, "m1", false, () => false, 1), { kind: "ready", read: READ });
  assert.deepEqual(calls.requests, []);
});

test("asks once, then waits until the version is stored", async () => {
  const { a, calls } = api({ reads: [null, null, null, READ] });
  assert.deepEqual(await loadBulkRead(a, "m1", false, () => false, 1), { kind: "ready", read: READ });
  assert.deepEqual(calls.requests, [false]);
});

test("shows the worker's error and Retry asks again without looking at the old version first", async () => {
  const { a, calls } = api({ failures: ["Readable versions are paused until the 1st."] });
  assert.deepEqual(await loadBulkRead(a, "m1", true, () => false, 1), { kind: "error", message: "Readable versions are paused until the 1st.", retry: true });
  assert.deepEqual(calls.requests, [true]);
  assert.equal(calls.stored, 1);
});

test("a request that cannot be made, or takes too long, is an error with Retry", async () => {
  assert.deepEqual(await loadBulkRead(api({ request: async () => false }).a, "m1", false, () => false, 1), { kind: "error", message: BULK_TEXT.cannotAsk, retry: true });
  assert.deepEqual(await loadBulkRead(api().a, "m1", false, () => false, 1, 3), { kind: "error", message: BULK_TEXT.slow, retry: true });
});

test("stops when asked to, and a hidden tab pauses the clock", async () => {
  assert.equal(await loadBulkRead(api().a, "m1", false, () => true, 1), null);
  let looks = 0;
  const hidden = api({ visible: () => looks++ >= 5, reads: [null, null, READ] });
  assert.deepEqual(await loadBulkRead(hidden.a, "m1", false, () => false, 1, 2), { kind: "ready", read: READ });
});
