// Tests for the Graph notification helpers: clientState signing (pinned to the web app's), and subscription timing.

import { test } from "node:test";
import assert from "node:assert/strict";
import { SUBSCRIPTION_LIFETIME_MS, accountFromClientState, clientStateFor, formatSubscription, parseSubscription, renewalDue, subscriptionBody } from "./graph-notify";

const A = "123e4567-e89b-42d3-a456-426614174000";
const HOUR = 3_600_000;

test("the signing matches the web app's (the same fixed value is pinned in its test)", () => {
  assert.equal(clientStateFor(A, "test-secret"), `${A}.NNEtxoqKNT-iaypS6DHgth5deJFRIsEvoJTTRb2oA_U`);
});

test("a clientState round trips and a forged one does not", () => {
  assert.equal(accountFromClientState(clientStateFor(A, "s"), "s"), A);
  assert.equal(accountFromClientState(clientStateFor(A, "s"), "t"), null);
  assert.equal(accountFromClientState("junk", "s"), null);
  assert.ok(clientStateFor(A, "s").length <= 128);
});

test("a saved subscription round trips and bad values are ignored", () => {
  assert.deepEqual(parseSubscription(formatSubscription({ id: "abc-1", expiresAt: 5000 })), { id: "abc-1", expiresAt: 5000 });
  assert.equal(parseSubscription(null), null);
  assert.equal(parseSubscription("abc"), null);
  assert.equal(parseSubscription("|5"), null);
});

test("a subscription is renewed when 48 hours or less remain, or when there is none", () => {
  const now = 1_000 * HOUR;
  assert.equal(renewalDue(null, now), true);
  assert.equal(renewalDue({ id: "x", expiresAt: now + 60 * HOUR }, now), false);
  assert.equal(renewalDue({ id: "x", expiresAt: now + 48 * HOUR }, now), true);
  assert.equal(renewalDue({ id: "x", expiresAt: now - 1 }, now), true);
});

test("a new subscription asks for mail, signs its clientState and stays inside Graph's limit", () => {
  const body = subscriptionBody({ accountId: A, url: "https://app.example/api/graph/notify", secret: "s", now: 0 });
  assert.equal(body.resource, "me/messages");
  assert.equal(body.notificationUrl, "https://app.example/api/graph/notify");
  assert.equal(accountFromClientState(body.clientState, "s"), A);
  assert.equal(Date.parse(body.expirationDateTime), SUBSCRIPTION_LIFETIME_MS);
  assert.ok(SUBSCRIPTION_LIFETIME_MS < 4230 * 60_000);
});
