// Tests for view-params.ts: which Admin view, period and switch an address asks for, and where old Analytics links land.

import { test } from "node:test";
import assert from "node:assert/strict";
import { adminHrefFromAnalytics, readAdminParams } from "./view-params";

const q = (s: string) => new URLSearchParams(s);

test("an address with nothing asked for opens Overview over 30 days with the switch off", () => {
  assert.deepEqual(readAdminParams(q("")), { view: "overview", days: 30, exclude: false });
});

test("a known view, period and switch are read as asked", () => {
  assert.deepEqual(readAdminParams(q("view=teams&days=7&exclude=1")), { view: "teams", days: 7, exclude: true });
});

test("an unknown view or period falls back instead of breaking the page", () => {
  assert.deepEqual(readAdminParams(q("view=updates&days=12")), { view: "overview", days: 30, exclude: false });
});

test("the old Analytics tabs map to the new views", () => {
  assert.equal(readAdminParams(q("tab=health")).view, "overview");
  assert.equal(readAdminParams(q("tab=usage")).view, "usage");
  assert.equal(readAdminParams(q("tab=ai")).view, "ai");
  assert.equal(readAdminParams(q("tab=nonsense")).view, "overview");
});

test("an old Analytics link lands on the matching Admin view and keeps its period and switch", () => {
  assert.equal(adminHrefFromAnalytics(q("")), "/admin?view=overview");
  assert.equal(adminHrefFromAnalytics(q("tab=ai&days=90&exclude=1")), "/admin?view=ai&days=90&exclude=1");
  assert.equal(adminHrefFromAnalytics(q("tab=usage&days=30")), "/admin?view=usage");
});

test("the old Company Logos page lands on the Logos view", () => {
  assert.equal(adminHrefFromAnalytics(q(""), "logos"), "/admin?view=logos");
});
