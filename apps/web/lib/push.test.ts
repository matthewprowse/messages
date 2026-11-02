// Tests for lib/push.ts: when push can be turned on (including the iPhone install rule), the VAPID key as bytes, the
// subscription row, and the app badge count.

import test from "node:test";
import assert from "node:assert/strict";
import { badgeCount, pushAvailability, subscriptionRow, vapidKeyBytes, type PushEnv } from "./push";

const base: PushEnv = { hasServiceWorker: true, hasPushManager: true, hasNotification: true, standalone: false, ios: false, permission: "default", vapidKey: "BKey" };

test("push is ready on a desktop browser with a key and no refusal", () => {
  assert.equal(pushAvailability(base), "ready");
  assert.equal(pushAvailability({ ...base, permission: "granted" }), "ready");
});

test("each blocker is named in the order a person would fix it", () => {
  assert.equal(pushAvailability({ ...base, hasServiceWorker: false }), "unsupported");
  assert.equal(pushAvailability({ ...base, hasPushManager: false }), "unsupported");
  assert.equal(pushAvailability({ ...base, vapidKey: "" }), "unconfigured");
  assert.equal(pushAvailability({ ...base, permission: "denied" }), "blocked");
});

test("an iPhone browser tab asks for the Home Screen install, an installed app does not", () => {
  assert.equal(pushAvailability({ ...base, ios: true }), "needs-install");
  assert.equal(pushAvailability({ ...base, ios: true, hasPushManager: false, hasNotification: false }), "needs-install");
  assert.equal(pushAvailability({ ...base, ios: true, standalone: true }), "ready");
});

test("the VAPID key decodes from URL-safe base64", () => {
  // "Hello?>" is 48 65 6c 6c 6f 3f 3e, whose base64 has the URL-unsafe characters.
  assert.deepEqual([...vapidKeyBytes("SGVsbG8_Pg")], [72, 101, 108, 108, 111, 63, 62]);
  assert.equal(vapidKeyBytes("").length, 0);
});

test("a subscription becomes a row only with an endpoint and both keys", () => {
  const json = { endpoint: "https://push.example.com/abc", keys: { p256dh: "p", auth: "a" } };
  assert.deepEqual(subscriptionRow(json, "u1", "Agent"), { user_id: "u1", endpoint: json.endpoint, p256dh: "p", auth: "a", user_agent: "Agent" });
  assert.equal(subscriptionRow({ endpoint: json.endpoint }, "u1", ""), null);
  assert.equal(subscriptionRow({ keys: json.keys }, "u1", ""), null);
  assert.equal(subscriptionRow({ ...json, keys: { p256dh: "p" } }, "u1", ""), null);
  assert.equal(subscriptionRow(json, "u1", "")?.user_agent, null);
});

test("the badge counts unread inbox conversations from others, not junk, archived or your own", () => {
  const t = (over = {}) => ({ status: "inbox" as const, junk: false, unread: true, lastFromMe: false, ...over });
  assert.equal(badgeCount([t(), t(), t({ junk: true }), t({ unread: false }), t({ lastFromMe: true }), t({ status: "archived" as const })]), 2);
  assert.equal(badgeCount([]), 0);
});
