// Tests for the Pub/Sub pull client with a fake fetch: it never reaches Google.

import { test } from "node:test";
import assert from "node:assert/strict";
import { PubSubError, PubSubPull } from "./pubsub";

function fake(reply: unknown, status = 200) {
  const calls: { url: string; body: unknown; auth: string | null }[] = [];
  const doFetch = (async (url: string, init: RequestInit) => {
    calls.push({ url, body: JSON.parse(String(init.body)), auth: new Headers(init.headers).get("authorization") });
    return new Response(JSON.stringify(reply), { status });
  }) as unknown as typeof fetch;
  return { calls, puller: new PubSubPull("projects/p/subscriptions/s", async () => "tok", doFetch) };
}

test("pull asks the subscription and maps the messages", async () => {
  const { calls, puller } = fake({ receivedMessages: [{ ackId: "a1", message: { messageId: "m1", data: "eA==" } }, { ackId: "a2" }] });
  const out = await puller.pull(10);
  assert.equal(calls[0]!.url, "https://pubsub.googleapis.com/v1/projects/p/subscriptions/s:pull");
  assert.equal(calls[0]!.auth, "Bearer tok");
  assert.deepEqual(calls[0]!.body, { maxMessages: 10 });
  assert.deepEqual(out, [{ ackId: "a1", messageId: "m1", data: "eA==" }, { ackId: "a2", messageId: "", data: undefined }]);
});

test("an empty pull gives an empty list", async () => {
  assert.deepEqual(await fake({}).puller.pull(), []);
});

test("ack and release send the ids, and do nothing for none", async () => {
  const { calls, puller } = fake({});
  await puller.ack([]);
  await puller.release([]);
  assert.equal(calls.length, 0);
  await puller.ack(["a1"]);
  await puller.release(["a2"]);
  assert.ok(calls[0]!.url.endsWith(":acknowledge"));
  assert.deepEqual(calls[1]!.body, { ackIds: ["a2"], ackDeadlineSeconds: 0 });
});

test("a failed call throws a coded error", async () => {
  await assert.rejects(fake({}, 403).puller.pull(), (err) => err instanceof PubSubError && err.code === "HTTP_403");
});
