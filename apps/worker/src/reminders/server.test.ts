import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { after, before, test } from "node:test";
import type { RelaySync, RelayUpdate } from "./protocol";
import { limiter, relayHandler, relayTokenHash, type RelayAccount } from "./server";

const TOKEN = "konva_rr_test-token";
const OTHER = "konva_rr_other-token";
const UPDATE_ID = "6f1c2a8e-0000-4000-8000-000000000001";

/** A relay account that records what it was asked, standing in for the connector. */
function fakeAccount() {
  const calls = { syncs: [] as RelaySync[], waits: [] as number[], reports: [] as { id: string; result: unknown }[] };
  const queued: RelayUpdate[] = [{ id: UPDATE_ID, reminderId: "R1", action: "complete" }];
  const account: RelayAccount = {
    async sync(sync) {
      calls.syncs.push(sync);
      return { stored: sync.reminders.length, removed: 0 };
    },
    async updates(waitMs) {
      calls.waits.push(waitMs);
      return queued;
    },
    async report(id, result) {
      calls.reports.push({ id, result });
      return id === UPDATE_ID;
    },
  };
  return { account, calls };
}

const mine = fakeAccount();
const theirs = fakeAccount();
let server: Server;
let base = "";

before(async () => {
  const accounts = new Map([[relayTokenHash(TOKEN), mine.account], [relayTokenHash(OTHER), theirs.account]]);
  const handle = relayHandler((hash) => accounts.get(hash));
  server = createServer((req, res) => void handle(req, res));
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

after(() => new Promise<void>((resolve) => server.close(() => resolve())));

const call = (path: string, init: RequestInit & { token?: string } = {}) =>
  fetch(`${base}${path}`, { ...init, headers: { ...(init.token ? { authorization: `Bearer ${init.token}` } : {}), "content-type": "application/json" } });

test("a token is kept only as its hash", () => {
  assert.match(relayTokenHash(TOKEN), /^[0-9a-f]{64}$/);
  assert.notEqual(relayTokenHash(TOKEN), relayTokenHash(OTHER));
});

test("a sync reaches only the account its token belongs to", async () => {
  const body = { version: 1, access: "full", timeZone: "Africa/Johannesburg", lists: [{ id: "L1", name: "Clients" }], reminders: [{ id: "R1", listId: "L1", title: "Call Sam", completed: false, priority: 0 }] };
  const res = await call("/v1/reminders/sync", { method: "POST", body: JSON.stringify(body), token: TOKEN });
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { stored: 1, removed: 0 });
  assert.equal(mine.calls.syncs.length, 1);
  assert.equal(mine.calls.syncs[0].reminders[0].title, "Call Sam");
  assert.equal(theirs.calls.syncs.length, 0);
});

test("a bad sync is refused before the account sees it", async () => {
  const before = mine.calls.syncs.length;
  const res = await call("/v1/reminders/sync", { method: "POST", body: JSON.stringify({ version: 9 }), token: TOKEN });
  assert.equal(res.status, 400);
  assert.deepEqual(await res.json(), { error: "bad_version" });
  const notJson = await call("/v1/reminders/sync", { method: "POST", body: "{", token: TOKEN });
  assert.equal(notJson.status, 400);
  assert.equal(mine.calls.syncs.length, before);
});

test("queued changes are handed out with the wait capped", async () => {
  const res = await call("/v1/reminders/updates?wait=600", { token: TOKEN });
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { updates: [{ id: UPDATE_ID, reminderId: "R1", action: "complete" }] });
  assert.equal(mine.calls.waits.at(-1), 25_000);
  await call("/v1/reminders/updates?wait=nonsense", { token: TOKEN });
  assert.equal(mine.calls.waits.at(-1), 0);
});

test("a report settles only a change the account has", async () => {
  const ok = await call(`/v1/reminders/updates/${UPDATE_ID}`, { method: "POST", body: JSON.stringify({ ok: true }), token: TOKEN });
  assert.equal(ok.status, 200);
  const unknown = await call("/v1/reminders/updates/6f1c2a8e-0000-4000-8000-000000000002", { method: "POST", body: JSON.stringify({ ok: false, error: "not_found" }), token: TOKEN });
  assert.equal(unknown.status, 404);
  assert.deepEqual(mine.calls.reports.at(-1)?.result, { ok: false, error: "This reminder is no longer in Reminders on your Mac." });
  const notAnId = await call("/v1/reminders/updates/../../tasks", { method: "POST", body: JSON.stringify({ ok: true }), token: TOKEN });
  assert.equal(notAnId.status, 404);
  assert.equal(theirs.calls.reports.length, 0);
});

test("a wrong method or path is refused", async () => {
  assert.equal((await call("/v1/reminders/sync", { token: TOKEN })).status, 405);
  assert.equal((await call("/v1/reminders/updates", { method: "POST", body: "{}", token: TOKEN })).status, 405);
  assert.equal((await call("/v1/anything", { token: TOKEN })).status, 404);
});

test("a body over the cap is refused", async () => {
  const res = await call("/v1/reminders/sync", { method: "POST", body: "x".repeat(8 * 1024 * 1024 + 1), token: TOKEN });
  assert.equal(res.status, 413);
});

test("no token or a wrong one is refused, and soon limited", async () => {
  assert.equal((await call("/v1/reminders/sync", { method: "POST", body: "{}" })).status, 401);
  let last = 0;
  for (let i = 0; i < 12; i++) last = (await call("/v1/reminders/updates", { token: `wrong-${i}` })).status;
  assert.equal(last, 429);
  // The right token still works from the same address.
  assert.equal((await call("/v1/reminders/updates", { token: OTHER })).status, 200);
});

test("the limiter counts per key and resets after its window", () => {
  const over = limiter(2, 60_000);
  assert.equal(over("a", 0), 0);
  assert.equal(over("a", 1), 0);
  assert.equal(over("a", 2), 60);
  assert.equal(over("b", 2), 0);
  assert.equal(over("a", 60_001), 0);
});
