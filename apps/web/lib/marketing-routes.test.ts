// Tests for marketing-routes.ts: which paths skip the app's sign-in and frame.

import { test } from "node:test";
import assert from "node:assert/strict";
import { isMarketingPath } from "./marketing-routes";

test("the home page and the listed pages are public, with or without a trailing slash", () => {
  assert.equal(isMarketingPath("/"), true);
  assert.equal(isMarketingPath("/pricing"), true);
  assert.equal(isMarketingPath("/pricing/"), true);
  assert.equal(isMarketingPath("/request-access"), true);
  assert.equal(isMarketingPath("/updates"), true);
});

test("app pages and anything below a marketing page stay in the app", () => {
  assert.equal(isMarketingPath("/inbox"), false);
  assert.equal(isMarketingPath("/login"), false);
  assert.equal(isMarketingPath("/pricing/annual"), false);
  assert.equal(isMarketingPath("/privacy-settings"), false);
});
