// Tests for Gmail push helpers: notification parsing, the history cursor rules, watch renewal timing and routing.

import { test } from "node:test";
import assert from "node:assert/strict";
import { PushRouter, historyIsNewer, parseGmailNotification, parseWatchReply, shouldWake, watchDue } from "./gmail-push";

const data = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64");
const HOUR = 3_600_000;

test("a Gmail notification gives a lower case address and a history id", () => {
  assert.deepEqual(parseGmailNotification(data({ emailAddress: "Me@Example.com", historyId: 12345 })), { address: "me@example.com", historyId: "12345" });
  assert.deepEqual(parseGmailNotification(data({ emailAddress: "a@b.co", historyId: "99" })), { address: "a@b.co", historyId: "99" });
});

test("anything else is not a notification", () => {
  assert.equal(parseGmailNotification(undefined), null);
  assert.equal(parseGmailNotification("%%%"), null);
  assert.equal(parseGmailNotification(data({ emailAddress: "nope", historyId: 1 })), null);
  assert.equal(parseGmailNotification(data({ emailAddress: "a@b.co", historyId: "abc" })), null);
  assert.equal(parseGmailNotification(data({ emailAddress: "a@b.co" })), null);
});

test("history ids compare as big numbers", () => {
  assert.equal(historyIsNewer("9007199254740993", "9007199254740992"), true);
  assert.equal(historyIsNewer("100", "99"), true);
  assert.equal(historyIsNewer("99", "100"), false);
  assert.equal(historyIsNewer("100", "100"), false);
  assert.equal(historyIsNewer("100", null), true);
  assert.equal(historyIsNewer("100", "garbage"), true);
  assert.equal(historyIsNewer("garbage", "1"), false);
});

test("only a notification later than the stored cursor wakes the connector", () => {
  assert.equal(shouldWake("200", "100"), true);
  assert.equal(shouldWake("100", "100"), false); // the echo of a change already read
  assert.equal(shouldWake("50", "100"), false); // late or out of order
  assert.equal(shouldWake("50", null), true); // no cursor yet: the first sync decides
});

test("the watch is started when missing and renewed daily, or when close to expiry", () => {
  const now = 1_000 * HOUR;
  assert.equal(watchDue(null, now), true);
  const fresh = { expiresAt: now + 7 * 24 * HOUR, renewedAt: now };
  assert.equal(watchDue(fresh, now + 23 * HOUR), false);
  assert.equal(watchDue(fresh, now + 24 * HOUR), true);
  assert.equal(watchDue({ expiresAt: now + 1 * HOUR, renewedAt: now }, now), true);
  assert.equal(watchDue({ expiresAt: now + 3 * HOUR, renewedAt: now }, now), false);
});

test("a watch reply needs a usable expiry", () => {
  assert.deepEqual(parseWatchReply({ historyId: "1", expiration: "2000" }, 1_000), { expiresAt: 2_000, renewedAt: 1_000 });
  assert.equal(parseWatchReply({ historyId: "1" }, 1_000), null);
  assert.equal(parseWatchReply({ expiration: "500" }, 1_000), null);
});

test("a notification wakes every connector for the address, and none after they unregister", () => {
  const router = new PushRouter();
  const seen: string[] = [];
  const off1 = router.register("Me@Example.com", "a1", (h) => seen.push(`a1:${h}`));
  router.register("me@example.com", "a2", (h) => seen.push(`a2:${h}`));
  assert.equal(router.route({ address: "me@example.com", historyId: "7" }), 2);
  assert.deepEqual(seen, ["a1:7", "a2:7"]);
  off1();
  assert.equal(router.route({ address: "me@example.com", historyId: "8" }), 1);
  assert.equal(router.route({ address: "other@example.com", historyId: "8" }), 0);
});
