// Tests for push/endpoint.ts: only the browsers' push services are accepted, on https and port 443, and look-alike
// hosts, private addresses and credentials are refused.

import test from "node:test";
import assert from "node:assert/strict";
import { isPushServiceEndpoint } from "./endpoint";

test("the real browsers' push endpoints are accepted", () => {
  for (const e of [
    "https://fcm.googleapis.com/fcm/send/abc:def",
    "https://web.push.apple.com/QGhi",
    "https://updates.push.services.mozilla.com/wpush/v2/gAAA",
    "https://wns2-par02p.notify.windows.com/w/?token=BQYAAA",
    "https://FCM.googleapis.com:443/fcm/send/x",
  ]) assert.equal(isPushServiceEndpoint(e), true, e);
});

test("any other host, scheme, port or credential is refused", () => {
  for (const e of [
    "https://example.com/push",
    "https://fcm.googleapis.com.evil.com/x",
    "https://evilfcm.googleapis.com/x",
    "https://notify.windows.com/x",
    "https://push.apple.com.example.org/x",
    "https://xpush.apple.com/x",
    "http://fcm.googleapis.com/fcm/send/x",
    "https://fcm.googleapis.com:8443/x",
    "https://user:pw@fcm.googleapis.com/x",
    "https://127.0.0.1/x",
    "https://[::1]/x",
    "not a url",
    `https://fcm.googleapis.com/${"a".repeat(3000)}`,
  ]) assert.equal(isPushServiceEndpoint(e), false, e);
});
