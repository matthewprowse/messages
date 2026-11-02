// Tests for sorting a Pub/Sub pull: acknowledge, wake, or give back for another shard. Importing the module pulls in
// the Google token helper but starts nothing: the pull loop only starts when gmailPush() is called.

import { test } from "node:test";
import assert from "node:assert/strict";
import { PushRouter } from "../google/gmail-push";
import { pumpOnce, sortBatch } from "./gmail-push";

const msg = (ackId: string, o: unknown) => ({ ackId, messageId: ackId, data: Buffer.from(JSON.stringify(o)).toString("base64") });

test("a known mailbox is woken and acknowledged", () => {
  const router = new PushRouter();
  const woken: string[] = [];
  router.register("me@example.com", "a1", (h) => woken.push(h));
  const out = sortBatch([msg("1", { emailAddress: "me@example.com", historyId: 5 })], router, false);
  assert.deepEqual(out, { ack: ["1"], release: [] });
  assert.deepEqual(woken, ["5"]);
});

test("an unknown mailbox is acknowledged with one worker and given back with several", () => {
  const router = new PushRouter();
  const m = msg("1", { emailAddress: "gone@example.com", historyId: 5 });
  assert.deepEqual(sortBatch([m], router, false), { ack: ["1"], release: [] });
  assert.deepEqual(sortBatch([m], router, true), { ack: [], release: ["1"] });
});

test("garbage is acknowledged so it never comes back", () => {
  const out = sortBatch([{ ackId: "9", messageId: "9", data: "%%" }], new PushRouter(), true);
  assert.deepEqual(out, { ack: ["9"], release: [] });
});

test("one pump acknowledges and releases through the puller, and says whether it released", async () => {
  const router = new PushRouter();
  router.register("me@example.com", "a1", () => undefined);
  const calls: string[] = [];
  const puller = {
    pull: async () => [msg("1", { emailAddress: "me@example.com", historyId: 5 }), msg("2", { emailAddress: "other@example.com", historyId: 6 })],
    ack: async (ids: string[]) => void calls.push(`ack:${ids}`),
    release: async (ids: string[]) => void calls.push(`release:${ids}`),
  };
  assert.equal(await pumpOnce(puller, router, true), true);
  assert.deepEqual(calls, ["ack:1", "release:2"]);
  assert.equal(await pumpOnce({ ...puller, pull: async () => [] }, router, true), false);
});
