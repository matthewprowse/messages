// Tests for the shard lease: acquire, renew, lost, retry and missing-function paths, against a fake database.

import assert from "node:assert/strict";
import { test } from "node:test";
import { acquire, isMissingRpc, Lease, LEASE_SAFETY_MS, type LeaseDb } from "./lease";

type Reply = { data: unknown; error: { code?: string } | null } | "throw";

function fakeDb(replies: Reply[]) {
  const calls: { fn: string; args: Record<string, unknown> }[] = [];
  const db: LeaseDb = {
    rpc: async (fn, args) => {
      calls.push({ fn, args });
      if (fn === "release_worker_lease") return { data: null, error: null };
      const r = replies.shift() ?? { data: true, error: null };
      if (r === "throw") throw new Error("network");
      return r;
    },
  };
  return { db, calls };
}

const logs = () => {
  const seen: string[] = [];
  return { seen, log: { info: (m: string) => void seen.push(`i:${m}`), warn: (m: string) => void seen.push(`w:${m}`), error: (m: string) => void seen.push(`e:${m}`) } };
};

test("acquire maps replies to outcomes", async () => {
  assert.equal(await acquire(fakeDb([{ data: true, error: null }]).db, "a", "h"), "held");
  assert.equal(await acquire(fakeDb([{ data: false, error: null }]).db, "a", "h"), "taken");
  assert.equal(await acquire(fakeDb([{ data: null, error: { code: "42883" } }]).db, "a", "h"), "missing");
  assert.equal(await acquire(fakeDb([{ data: null, error: { code: "PGRST202" } }]).db, "a", "h"), "missing");
  assert.equal(await acquire(fakeDb([{ data: null, error: { code: "08006" } }]).db, "a", "h"), "error");
  assert.equal(await acquire(fakeDb(["throw"]).db, "a", "h"), "error");
  assert.equal(isMissingRpc("42883"), true);
  assert.equal(isMissingRpc("23505"), false);
});

test("start holds the lease, renews it and releases it", async () => {
  const { db, calls } = fakeDb([{ data: true, error: null }, { data: true, error: null }]);
  let lost = 0;
  const lease = new Lease({ db, name: "shard-0", holder: "me", log: logs().log, onLost: () => lost++ });
  assert.equal(await lease.start(), "held");
  await lease.renew();
  await lease.release();
  assert.deepEqual(calls.map((c) => c.fn), ["acquire_worker_lease", "acquire_worker_lease", "release_worker_lease"]);
  assert.deepEqual(calls[0].args, { p_name: "shard-0", p_holder: "me", p_ttl_seconds: 90 });
  assert.equal(lost, 0);
});

test("start reports a lease held by someone else", async () => {
  const { db, calls } = fakeDb([{ data: false, error: null }]);
  const lease = new Lease({ db, name: "shard-0", holder: "me", log: logs().log, onLost: () => assert.fail("not held") });
  assert.equal(await lease.start(), "taken");
  await lease.release();
  assert.equal(calls.some((c) => c.fn === "release_worker_lease"), false);
});

test("a database error at startup rejects", async () => {
  const lease = new Lease({ db: fakeDb(["throw"]).db, name: "shard-0", holder: "me", log: logs().log, onLost: () => undefined });
  await assert.rejects(lease.start());
});

test("a missing RPC runs without a lease and warns once", async () => {
  const { db, calls } = fakeDb([{ data: null, error: { code: "PGRST202" } }]);
  const { log, seen } = logs();
  const lease = new Lease({ db, name: "shard-0", holder: "me", log, onLost: () => assert.fail("no lease to lose") });
  assert.equal(await lease.start(), "unleased");
  await lease.renew();
  await lease.release();
  assert.equal(seen.filter((s) => s.startsWith("w:")).length, 1);
  assert.equal(calls.length, 1);
});

test("a renewal that finds another holder loses the lease", async () => {
  const { db } = fakeDb([{ data: true, error: null }, { data: false, error: null }]);
  let lost = 0;
  const lease = new Lease({ db, name: "shard-0", holder: "me", log: logs().log, onLost: () => lost++ });
  await lease.start();
  await lease.renew();
  assert.equal(lost, 1);
  await lease.renew();
  assert.equal(lost, 1);
  await lease.release();
});

test("a transient error retries until the lease is nearly out", async () => {
  let t = 1_000_000;
  const { db } = fakeDb([{ data: true, error: null }, "throw", { data: null, error: { code: "08006" } }, "throw"]);
  let lost = 0;
  const lease = new Lease({ db, name: "shard-0", holder: "me", log: logs().log, onLost: () => lost++, now: () => t });
  await lease.start();
  t += 30_000;
  await lease.renew();
  assert.equal(lost, 0);
  t += 30_000;
  await lease.renew();
  assert.equal(lost, 0);
  t += 90_000 - 60_000 - LEASE_SAFETY_MS; // 80 s after the last good renewal
  await lease.renew();
  assert.equal(lost, 1);
});

test("a renewal that recovers keeps the lease", async () => {
  let t = 0;
  const { db } = fakeDb([{ data: true, error: null }, "throw", { data: true, error: null }]);
  let lost = 0;
  const lease = new Lease({ db, name: "shard-0", holder: "me", log: logs().log, onLost: () => lost++, now: () => t });
  await lease.start();
  t += 30_000;
  await lease.renew();
  t += 5_000;
  await lease.renew();
  assert.equal(lost, 0);
  await lease.release();
});
