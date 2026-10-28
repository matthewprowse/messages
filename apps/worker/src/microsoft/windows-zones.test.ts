// Tests for windows-zones.ts: Windows zone names map to IANA zones in any case, IANA names pass through,
// unknown names give null.

import { test } from "node:test";
import assert from "node:assert/strict";
import { ianaZone } from "./windows-zones";

test("a Windows zone name maps to its IANA zone, in any case", () => {
  assert.equal(ianaZone("South Africa Standard Time"), "Africa/Johannesburg");
  assert.equal(ianaZone("  gmt standard time "), "Europe/London");
  assert.equal(ianaZone("UTC"), "UTC");
});

test("an IANA name Intl knows passes through", () => {
  assert.equal(ianaZone("Africa/Johannesburg"), "Africa/Johannesburg");
});

test("an unknown or empty name is null", () => {
  assert.equal(ianaZone("Not/AZone"), null);
  assert.equal(ianaZone("Made Up Standard Time"), null);
  assert.equal(ianaZone(""), null);
  assert.equal(ianaZone(null), null);
  assert.equal(ianaZone(undefined), null);
});
