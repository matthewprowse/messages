// Tests for lib/signed-urls/open-limits.ts: phones and low memory devices open smaller sealed files than desktops.

import { test } from "node:test";
import assert from "node:assert/strict";
import { exceedsOpenLimit, isAppleTouchDevice, OPEN_MAX, sealedOpenLimit, SMALL_DEVICE_OPEN_MAX } from "./open-limits";

const IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1";
const MAC = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/18.0 Safari/605.1.15";

test("an iPhone, and an iPad that calls itself a Mac, get the small limit; a real Mac does not", () => {
  assert.equal(sealedOpenLimit({ userAgent: IPHONE }), SMALL_DEVICE_OPEN_MAX);
  assert.equal(isAppleTouchDevice({ userAgent: MAC, touchPoints: 5 }), true);
  assert.equal(sealedOpenLimit({ userAgent: MAC, touchPoints: 5 }), SMALL_DEVICE_OPEN_MAX);
  assert.equal(sealedOpenLimit({ userAgent: MAC, touchPoints: 0 }), OPEN_MAX);
});

test("a device that reports 2 GB or less is small too, and one that does not report is trusted", () => {
  assert.equal(sealedOpenLimit({ userAgent: "Android", memoryGb: 2 }), SMALL_DEVICE_OPEN_MAX);
  assert.equal(sealedOpenLimit({ userAgent: "Android", memoryGb: 8 }), OPEN_MAX);
  assert.equal(sealedOpenLimit({ userAgent: "Firefox" }), OPEN_MAX);
});

test("a download over the limit is refused before it starts, and an unknown size is let through", () => {
  assert.equal(exceedsOpenLimit(30 * 1024 * 1024, SMALL_DEVICE_OPEN_MAX), true);
  assert.equal(exceedsOpenLimit(SMALL_DEVICE_OPEN_MAX, SMALL_DEVICE_OPEN_MAX), false);
  assert.equal(exceedsOpenLimit(null, SMALL_DEVICE_OPEN_MAX), false);
});
