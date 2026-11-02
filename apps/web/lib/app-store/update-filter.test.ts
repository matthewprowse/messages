// Tests for update-filter.ts: read-state-only message updates are skipped, real changes get through.

import assert from "node:assert/strict";
import { test } from "node:test";
import { createUpdateFilter } from "./update-filter";

test("the first sight of a message counts as a change, an identical repeat does not", () => {
  const f = createUpdateFilter();
  assert.equal(f.changed("m1", { body_text: "e1:abc", provider_meta: { r: 1 } }), true);
  assert.equal(f.changed("m1", { body_text: "e1:abc", provider_meta: { r: 1 } }), false);
});

test("a new reaction, edit or transcript is a change", () => {
  const f = createUpdateFilter();
  f.changed("m1", { body_text: "e1:abc", provider_meta: { r: 1 } });
  assert.equal(f.changed("m1", { body_text: "e1:abc", provider_meta: { r: 2 } }), true);
  assert.equal(f.changed("m1", { body_text: "e1:xyz", provider_meta: { r: 2 } }), true);
  assert.equal(f.changed("m1", { body_text: "e1:xyz", provider_meta: { r: 2 }, transcript: "e1:t" }), true);
});

test("a full filter forgets rather than growing", () => {
  const f = createUpdateFilter(2);
  f.changed("a", {}); f.changed("b", {});
  assert.equal(f.changed("c", {}), true);
  assert.equal(f.changed("a", {}), true);
});
