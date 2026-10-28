// Tests for keeping a shared chat's timeline across reloads.

import assert from "node:assert/strict";
import { test } from "node:test";
import { overlayPage, sameMark } from "./shared-chat-merge";

const m = (id: string, sentAt: string) => ({ id, sentAt });

test("a reload keeps older held messages and lets the new page win", () => {
  const held = [m("a", "2026-01-01"), m("b", "2026-01-02"), m("c", "2026-01-03")];
  const page = [m("b", "2026-01-02"), m("c", "2026-01-03"), m("d", "2026-01-04")];
  assert.deepEqual(overlayPage(held, page).map((x) => x.id), ["a", "b", "c", "d"]);
});

test("an empty page leaves what is held", () => {
  const held = [m("a", "2026-01-01")];
  assert.equal(overlayPage(held, []), held);
});

test("a held message newer than the page start but missing from it is dropped", () => {
  const held = [m("a", "2026-01-01"), m("x", "2026-01-03")];
  const page = [m("b", "2026-01-02")];
  assert.deepEqual(overlayPage(held, page).map((x) => x.id), ["a", "b"]);
});

test("the change check matches only an identical mark", () => {
  const a = { count: 3, newestId: "c", newestAt: "t" };
  assert.equal(sameMark(a, { ...a }), true);
  assert.equal(sameMark(a, { ...a, count: 4 }), false);
  assert.equal(sameMark(null, a), false);
});
