// Tests for storage-rules.ts: the video link rule, the open, grace and full states of a seat's cap, per-person and team usage reads,
// the one-minute cache, and that an unreadable usage fails open.

import { test } from "node:test";
import assert from "node:assert/strict";

process.env.SUPABASE_URL ??= "http://127.0.0.1:1";
process.env.SUPABASE_SERVICE_ROLE_KEY ??= "test";
process.env.ENCRYPTION_KEY ??= "test";

const { db } = await import("./db");
const rules = await import("./storage-rules");

const GB = 1024 ** 3;
const MB = 1024 ** 2;

test("a video over 25 MB is a link; smaller videos and other big files are copied", () => {
  assert.equal(rules.isVideoLink("video", 25 * MB + 1), true);
  assert.equal(rules.isVideoLink("video", 25 * MB), false);
  assert.equal(rules.isVideoLink("video", null), false);
  assert.equal(rules.isVideoLink("pdf", 40 * MB), false);
  assert.equal(rules.isVideoLink("image", 40 * MB), false);
});

test("the cap is open under 100%, grace to 110%, full after", () => {
  const cap = 20 * GB;
  assert.equal(rules.capState(0, cap), "open");
  assert.equal(rules.capState(cap - 1, cap), "open");
  assert.equal(rules.capState(cap, cap), "grace");
  assert.equal(rules.capState(cap * 1.0999, cap), "grace");
  assert.equal(rules.capState(cap * 1.1, cap), "full");
});

test("in the grace band only a message already started may save; full saves nothing", () => {
  assert.equal(rules.maySave("open", false), true);
  assert.equal(rules.maySave("grace", false), false);
  assert.equal(rules.maySave("grace", true), true);
  assert.equal(rules.maySave("full", true), false);
  assert.equal(rules.refusing("open"), false);
  assert.equal(rules.refusing("grace"), true);
});

function fakeDb(handlers: { team?: unknown; usage?: { bytes: number }[] }) {
  const calls = { rpc: 0, usage: 0 };
  Object.assign(db, {
    rpc: () => (calls.rpc++, Promise.resolve({ data: handlers.team ?? null, error: null })),
    from: () => ({
      select: () => ({ eq: () => (calls.usage++, Promise.resolve({ data: handlers.usage ?? [], error: null })) }),
    }),
  });
  return calls;
}

test("a person alone is measured against one seat, summed over kinds, and read once a minute", async () => {
  rules.resetUsageCache();
  const calls = fakeDb({ usage: [{ bytes: 3 * GB }, { bytes: 2 * GB }] });
  const first = await rules.usageFor("u1", 1_000);
  assert.deepEqual(first, { used: 5 * GB, cap: 20 * GB });
  await rules.usageFor("u1", 30_000);
  assert.equal(calls.usage, 1);
  await rules.usageFor("u1", 61_001);
  assert.equal(calls.usage, 2);
});

test("a team shares seats times 20 GB", async () => {
  rules.resetUsageCache();
  fakeDb({ team: { seats: 5, bytes: 90 * GB } });
  assert.deepEqual(await rules.usageFor("u2"), { used: 90 * GB, cap: 100 * GB });
  assert.equal(await rules.stateFor("u2"), "open");
  rules.resetUsageCache();
  fakeDb({ team: { seats: 5, bytes: 100 * GB } });
  assert.equal(await rules.stateFor("u2"), "grace");
});

test("a saved file is added to the cached usage at once", async () => {
  rules.resetUsageCache();
  fakeDb({ usage: [{ bytes: 20 * GB - 10 }] });
  assert.equal(await rules.stateFor("u3"), "open");
  await rules.noteSaved("u3", 20);
  assert.equal(await rules.stateFor("u3"), "grace");
});

test("an unreadable usage fails open, so files are kept as before", async () => {
  rules.resetUsageCache();
  Object.assign(db, {
    rpc: () => Promise.resolve({ data: null, error: { code: "X" } }),
    from: () => ({ select: () => ({ eq: () => Promise.resolve({ data: null, error: { code: "X" } }) }) }),
  });
  assert.equal(await rules.stateFor("u4"), "open");
});
