// Tests for creating and renewing a Graph mail subscription with a fake client: it never reaches Microsoft.

import { test } from "node:test";
import assert from "node:assert/strict";
import { GraphApiError } from "./client";
import { SUBSCRIPTION_LIFETIME_MS } from "./graph-notify";
import { ensureMailSubscription, type GraphLike } from "./subscriptions";

const HOUR = 3_600_000;
const base = { accountId: "123e4567-e89b-42d3-a456-426614174000", url: "https://app.example/api/graph/notify", secret: "s", now: 1_000 * HOUR };

function fake(handler: (path: string, method: string) => unknown) {
  const calls: string[] = [];
  const client: GraphLike = {
    request: (async (path: string, opts?: { method?: string }) => {
      const method = opts?.method ?? "GET";
      calls.push(`${method} ${path}`);
      return handler(path, method);
    }) as GraphLike["request"],
  };
  return { calls, client };
}

test("a subscription with time left is left alone", async () => {
  const { client, calls } = fake(() => { throw new Error("no calls expected"); });
  const saved = { id: "sub1", expiresAt: base.now + 60 * HOUR };
  assert.deepEqual(await ensureMailSubscription(client, { ...base, saved }), { sub: saved, changed: false });
  assert.equal(calls.length, 0);
});

test("one near its end is renewed with a patch", async () => {
  const { client, calls } = fake(() => ({}));
  const out = await ensureMailSubscription(client, { ...base, saved: { id: "sub1", expiresAt: base.now + 10 * HOUR } });
  assert.deepEqual(calls, ["PATCH /subscriptions/sub1"]);
  assert.deepEqual(out, { sub: { id: "sub1", expiresAt: base.now + SUBSCRIPTION_LIFETIME_MS }, changed: true });
});

test("none saved creates one, using the expiry Graph reports", async () => {
  const { client, calls } = fake(() => ({ id: "new1", expirationDateTime: new Date(base.now + 70 * HOUR).toISOString() }));
  const out = await ensureMailSubscription(client, { ...base, saved: null });
  assert.deepEqual(calls, ["POST /subscriptions"]);
  assert.deepEqual(out, { sub: { id: "new1", expiresAt: base.now + 70 * HOUR }, changed: true });
});

test("a subscription Graph no longer knows is created again", async () => {
  const { client, calls } = fake((_p, method) => {
    if (method === "PATCH") throw new GraphApiError(404, "ResourceNotFound");
    return { id: "new2" };
  });
  const out = await ensureMailSubscription(client, { ...base, saved: { id: "gone", expiresAt: base.now + HOUR } });
  assert.deepEqual(calls, ["PATCH /subscriptions/gone", "POST /subscriptions"]);
  assert.equal(out.sub.id, "new2");
});

test("any other failure is thrown for the connector to handle", async () => {
  const { client } = fake(() => { throw new GraphApiError(403, "Forbidden"); });
  await assert.rejects(ensureMailSubscription(client, { ...base, saved: null }), (err) => err instanceof GraphApiError && err.status === 403);
});
