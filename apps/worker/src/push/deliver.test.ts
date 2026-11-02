// Tests for push/payload.ts, deliver.ts, rate-limit.ts and config.ts: the payload carries no content, expired
// subscriptions are reported (and only 404 or 410), one bad device does not stop the others, the per-person limit holds.

import test from "node:test";
import assert from "node:assert/strict";
import { buildPayload } from "./payload";
import { deliver, isExpired, type PushSubscriptionRow, type SendFn } from "./deliver";
import { PushRateLimit } from "./rate-limit";
import { readVapid } from "./config";

const subs: PushSubscriptionRow[] = [
  { id: "s1", endpoint: "https://push.example.com/1", p256dh: "k1", auth: "a1" },
  { id: "s2", endpoint: "https://push.example.com/2", p256dh: "k2", auth: "a2" },
  { id: "s3", endpoint: "https://push.example.com/3", p256dh: "k3", auth: "a3" },
];

test("a payload holds only a kind, a thread id and fixed words", () => {
  const p = buildPayload("urgent", "11111111-2222-3333-4444-555555555555");
  assert.deepEqual(Object.keys(p).sort(), ["body", "kind", "threadId", "title", "v"]);
  assert.equal(p.threadId, "11111111-2222-3333-4444-555555555555");
  assert.equal(buildPayload("important", "x").body, "New message from a client.");
  // Nothing but the thread id may vary, so no name, address or text can ride along.
  assert.deepEqual({ ...buildPayload("important", "a"), threadId: "" }, { ...buildPayload("important", "b"), threadId: "" });
});

test("only 404 and 410 mean a subscription has expired", () => {
  assert.equal(isExpired({ statusCode: 410 }), true);
  assert.equal(isExpired({ statusCode: 404 }), true);
  assert.equal(isExpired({ statusCode: 429 }), false);
  assert.equal(isExpired({ statusCode: 500 }), false);
  assert.equal(isExpired(new Error("network")), false);
  assert.equal(isExpired(null), false);
});

test("delivery reports sent, expired and failed devices and keeps going after an error", async () => {
  const calls: string[] = [];
  const send: SendFn = async (sub, body, options) => {
    calls.push(sub.endpoint);
    assert.equal(JSON.parse(body).threadId, "t1");
    assert.equal(options.urgency, "high");
    if (sub.endpoint.endsWith("/1")) throw Object.assign(new Error("gone"), { statusCode: 410 });
    if (sub.endpoint.endsWith("/2")) throw Object.assign(new Error("busy"), { statusCode: 503 });
    return {};
  };
  const res = await deliver(subs, buildPayload("urgent", "t1"), "urgent", send);
  assert.deepEqual(res, { sent: 1, expired: ["s1"], failed: 1 });
  assert.equal(calls.length, 3);
});

test("Important pushes go out at normal urgency", async () => {
  let seen = "";
  await deliver(subs.slice(0, 1), buildPayload("important", "t"), "important", async (_s, _b, o) => { seen = o.urgency; });
  assert.equal(seen, "normal");
});

test("the rate limit allows a burst, then holds until the window passes, per person", () => {
  const limit = new PushRateLimit(3, 60_000);
  assert.deepEqual([0, 1, 2, 3].map((i) => limit.take("u1", 1000 + i)), [true, true, true, false]);
  assert.equal(limit.take("u2", 1004), true, "another person has their own allowance");
  assert.equal(limit.take("u1", 1000 + 60_001), true, "the window slides");
});

test("the sender needs all three VAPID values and a mailto or https subject", () => {
  const ok = { VAPID_PUBLIC_KEY: "pub", VAPID_PRIVATE_KEY: "priv", VAPID_SUBJECT: "mailto:a@example.com" };
  assert.deepEqual(readVapid(ok), { publicKey: "pub", privateKey: "priv", subject: "mailto:a@example.com" });
  assert.equal(readVapid({ ...ok, VAPID_PRIVATE_KEY: "" }), null);
  assert.equal(readVapid({ ...ok, VAPID_SUBJECT: "a@example.com" }), null);
  assert.equal(readVapid({}), null);
});
