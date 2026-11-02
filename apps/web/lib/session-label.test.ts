// session-label.ts: a user agent becomes a short, readable label.

import assert from "node:assert/strict";
import { test } from "node:test";
import { sessionLabel } from "./session-label";

test("common browsers on common systems", () => {
  assert.equal(sessionLabel("Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1"), "Safari on iPhone");
  assert.equal(sessionLabel("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36"), "Chrome on Mac");
  assert.equal(sessionLabel("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/130.0 Safari/537.36 Edg/130.0"), "Edge on Windows");
  assert.equal(sessionLabel("Mozilla/5.0 (Windows NT 10.0; rv:131.0) Gecko/20100101 Firefox/131.0"), "Firefox on Windows");
  assert.equal(sessionLabel("Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/130.0 Mobile Safari/537.36"), "Chrome on Android");
});

test("only a browser or only a system still reads", () => {
  assert.equal(sessionLabel("Safari/1"), "Safari");
  assert.equal(sessionLabel("Dalvik (Android 12)"), "Android");
});

test("nothing known is Unknown Device", () => {
  assert.equal(sessionLabel(null), "Unknown Device");
  assert.equal(sessionLabel(""), "Unknown Device");
  assert.equal(sessionLabel("curl/8.0"), "Unknown Device");
});
