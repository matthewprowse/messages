// Tests for paths.ts: a chosen logo's public name follows its content, and is told apart from the private names.

import { test } from "node:test";
import assert from "node:assert/strict";
import { isPublicLogoPath, logoKey, privateLogoPath, publicLogoPath } from "./paths";

test("a new picture for the same company gets a new public name", () => {
  const a = publicLogoPath("acme.com", Buffer.from("one"));
  assert.notEqual(a, publicLogoPath("acme.com", Buffer.from("two")));
  assert.equal(a, publicLogoPath("acme.com", Buffer.from("one")));
  assert.ok(a.startsWith(`${logoKey("acme.com")}-`));
});

test("public names are told apart from private ones and review files", () => {
  assert.equal(isPublicLogoPath(publicLogoPath("acme.com", Buffer.from("one"))), true);
  assert.equal(isPublicLogoPath(privateLogoPath("acme.com")), false);
  assert.equal(isPublicLogoPath(`review/${logoKey("acme.com")}/1-1.png`), false);
});
