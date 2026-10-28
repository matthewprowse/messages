// Tests for fetchRequestedAttachments (ingest/fetch-requests.ts) and the deferral rule (storage-rules.ts isDeferred)
// over faked dependencies: no database, provider or storage is touched.

import { test } from "node:test";
import assert from "node:assert/strict";

process.env.SUPABASE_URL ??= "http://127.0.0.1:1";
process.env.SUPABASE_SERVICE_ROLE_KEY ??= "test";
process.env.ENCRYPTION_KEY ??= "test";

const { fetchRequestedAttachments, FETCH_MESSAGES } = await import("./fetch-requests");
const { isDeferred, EAGER_COPY_MAX_BYTES } = await import("../storage-rules");
import type { FetchDeps, Target } from "./fetch-requests";

const MB = 1024 * 1024;
const DAY = 24 * 60 * 60 * 1000;

test("a small recent attachment is copied up front; a big or old one is deferred", () => {
  const now = Date.parse("2026-11-12T10:00:00Z");
  assert.equal(isDeferred(1 * MB, new Date(now - 2 * DAY), now), false);
  assert.equal(isDeferred(EAGER_COPY_MAX_BYTES, new Date(now - 2 * DAY), now), false);
  assert.equal(isDeferred(EAGER_COPY_MAX_BYTES + 1, new Date(now - 2 * DAY), now), true);
  assert.equal(isDeferred(1 * MB, new Date(now - 31 * DAY), now), true);
  assert.equal(isDeferred(1 * MB, new Date(now - 29 * DAY), now), false);
  assert.equal(isDeferred(1 * MB, null, now), false, "no date counts as new");
  assert.equal(isDeferred(null, "2026-11-11T10:00:00Z", now), false);
});

const target = (over: Partial<Target> = {}): Target => ({ id: "a1", user_id: "u1", message_id: "m1", size_bytes: 8 * MB, storage_path: null, account_id: "acc", provider_meta: { gmail_id: "g1" }, ...over });

function harness(opts: { target?: Target | null; files?: { filename: string }[] | null; outcome?: "saved" | "over_cap" | "no_match"; source?: boolean; throws?: boolean; requester?: string; owns?: boolean }) {
  const log: string[] = [];
  const deps: FetchDeps = {
    claim: async () => [{ attachment_id: "a1", user_id: opts.requester ?? "u1" }],
    target: async () => (opts.target === undefined ? target() : opts.target),
    sourceFor: () =>
      opts.source === false
        ? undefined
        : { attachmentsOf: async () => { if (opts.throws) throw new Error("boom"); return (opts.files === undefined ? [{ filename: "a.pdf" }] : opts.files) as never; } },
    keep: async () => opts.outcome ?? "saved",
    owns: opts.owns === undefined ? undefined : () => opts.owns as boolean,
    release: async (id) => void log.push(`release ${id}`),
    finish: async (id) => void log.push(`finish ${id}`),
    fail: async (id, message, unavailable) => void log.push(`fail ${id} ${unavailable} ${message}`),
  };
  return { deps, log };
}

test("a requested file is fetched, kept, and the request deleted", async () => {
  const h = harness({});
  assert.equal(await fetchRequestedAttachments(5, h.deps), 1);
  assert.deepEqual(h.log, ["finish a1"]);
});

test("a request for an account another shard runs is handed back unclaimed, not failed", async () => {
  const h = harness({ owns: false });
  assert.equal(await fetchRequestedAttachments(5, h.deps), 0);
  assert.deepEqual(h.log, ["release a1"]);
});

test("a request for an account this shard runs is fetched as usual", async () => {
  const h = harness({ owns: true });
  assert.equal(await fetchRequestedAttachments(5, h.deps), 1);
  assert.deepEqual(h.log, ["finish a1"]);
});

test("a message gone from the mailbox marks the file unavailable", async () => {
  const h = harness({ files: null });
  assert.equal(await fetchRequestedAttachments(5, h.deps), 0);
  assert.deepEqual(h.log, [`fail a1 true ${FETCH_MESSAGES.gone}`]);
});

test("a full seat leaves the file deferred and says why", async () => {
  const h = harness({ outcome: "over_cap" });
  await fetchRequestedAttachments(5, h.deps);
  assert.deepEqual(h.log, [`fail a1 false ${FETCH_MESSAGES.full}`]);
});

test("a mailbox that is not running, a provider error and a file over the upload limit fail without being marked gone", async () => {
  for (const [opts, message] of [
    [{ source: false }, FETCH_MESSAGES.offline],
    [{ throws: true }, FETCH_MESSAGES.failed],
    [{ target: target({ size_bytes: 60 * MB }) }, FETCH_MESSAGES.tooLarge],
  ] as const) {
    const h = harness(opts);
    await fetchRequestedAttachments(5, h.deps);
    assert.deepEqual(h.log, [`fail a1 false ${message}`]);
  }
});

test("a request for a stored file, a missing attachment or someone else's attachment is dropped", async () => {
  for (const opts of [{ target: target({ storage_path: "u1/m1/a1" }) }, { target: null }, { requester: "u2" }]) {
    const h = harness(opts);
    assert.equal(await fetchRequestedAttachments(5, h.deps), 0);
    assert.deepEqual(h.log, ["finish a1"]);
  }
});
