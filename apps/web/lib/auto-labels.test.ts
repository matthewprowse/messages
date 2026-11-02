// Tests for auto-labels.ts: the limit of six, tidying a description and when an Auto label is usable.

import { test } from "node:test";
import assert from "node:assert/strict";
import { AUTO_MAX, DESCRIPTION_MAX, canTurnOn, cleanDescription, isUsable, type AutoSetting } from "./auto-labels";

const on = (description = "x"): AutoSetting => ({ auto: true, description });
const off: AutoSetting = { auto: false, description: "" };

test("a description becomes one tidy line cut to its limit", () => {
  assert.equal(cleanDescription("  Clients \n with   a live deal "), "Clients with a live deal");
  assert.equal(cleanDescription("y".repeat(300)).length, DESCRIPTION_MAX);
});

test("no more than six labels can be Auto, but one already on stays on", () => {
  const full = new Map<string, AutoSetting>(Array.from({ length: AUTO_MAX }, (_, i) => [`l${i}`, on()] as const));
  full.set("extra", off);
  assert.equal(canTurnOn(full, "extra"), false);
  assert.equal(canTurnOn(full, "l0"), true);
  full.delete("l5");
  assert.equal(canTurnOn(full, "extra"), true);
});

test("an Auto label needs a description before it is usable", () => {
  assert.equal(isUsable(on("Tenants and landlords")), true);
  assert.equal(isUsable(on("   ")), false);
  assert.equal(isUsable(off), false);
  assert.equal(isUsable(undefined), false);
});
