// Tests for the logo job's schedule: a full read at start and daily, a look for new organizations every 15 minutes,
// links of the companies without a logo only when something finished, and never more often than every 10 minutes.

import { test } from "node:test";
import assert from "node:assert/strict";
process.env.SUPABASE_URL ??= "http://localhost";
process.env.SUPABASE_SERVICE_ROLE_KEY ??= "test";
const { enqueueMode, FULL_EVERY_MS, LINK_EVERY_MS, linkMode, newLogoState, NEW_ORGS_EVERY_MS } = await import("./job");

const T = 1_000_000_000_000;

test("the first run is a full one, then only new organizations every 15 minutes", () => {
  const s = newLogoState();
  assert.equal(enqueueMode(s, T), "full");
  s.watermark = "2026-01-01T00:00:00Z";
  s.lastFull = T;
  s.lastNewCheck = T;
  assert.equal(enqueueMode(s, T + 30_000), null);
  assert.equal(enqueueMode(s, T + NEW_ORGS_EVERY_MS), "new");
  assert.equal(enqueueMode(s, T + FULL_EVERY_MS), "full");
});

test("a full read always links; otherwise only when dirty and not within 10 minutes of the last link", () => {
  const s = newLogoState();
  s.lastLink = T;
  assert.equal(linkMode(s, T + 60_000, "full"), "full");
  assert.equal(linkMode(s, T + LINK_EVERY_MS, null), null);
  s.linkDirty = true;
  assert.equal(linkMode(s, T + 60_000, null), null);
  assert.equal(linkMode(s, T + LINK_EVERY_MS, "new"), "without");
});
