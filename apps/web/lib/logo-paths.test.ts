// Tests for logo-paths.ts: only a content-addressed logo name is read from the public bucket; older names and the
// owner's review files are signed from the private one.

import { test } from "node:test";
import assert from "node:assert/strict";
import { isPublicLogo } from "./logo-paths";

const key = "a".repeat(64);

test("a content-addressed logo is public", () => {
  assert.equal(isPublicLogo(`${key}-0123456789abcdef.png`), true);
});

test("an older logo and the review files stay private", () => {
  assert.equal(isPublicLogo(`${key}.png`), false);
  assert.equal(isPublicLogo(`review/${key}/1-1.png`), false);
  assert.equal(isPublicLogo(`review/${key}-0123456789abcdef.png`), false);
  assert.equal(isPublicLogo(`${key}-0123456789ABCDEF.png`), false);
  assert.equal(isPublicLogo(""), false);
});
