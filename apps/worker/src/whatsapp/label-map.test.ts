// label-map.ts: WhatsApp Business labels become Konva labels with a tidy name and a palette colour, and only chat labels count.

import assert from "node:assert/strict";
import { test } from "node:test";
import { colourOf, isChatAssociation, mapLabel } from "./label-map";

test("a label keeps its id, gets a tidy name and a palette colour", () => {
  assert.deepEqual(mapLabel({ id: "7", name: "  New   Customer ", color: 4, deleted: false }), { waId: "7", name: "New Customer", color: "green", deleted: false });
});

test("a long name is cut to what Konva shows", () => {
  assert.equal(mapLabel({ id: "1", name: "x".repeat(100), color: 0, deleted: false })!.name.length, 40);
});

test("a colour outside WhatsApp's range is grey, and every mapped colour is in the palette", () => {
  assert.equal(colourOf(99), "gray");
  assert.equal(colourOf(-1), "gray");
  assert.equal(colourOf(undefined), "gray");
  for (let i = 0; i < 20; i++) assert.ok(["gray", "red", "orange", "amber", "green", "teal", "blue", "violet", "pink"].includes(colourOf(i)));
});

test("a nameless label is skipped, but a deleted one is still passed on so it can be removed", () => {
  assert.equal(mapLabel({ id: "2", name: "  ", color: 1, deleted: false }), null);
  assert.equal(mapLabel({ id: "2", name: "", color: 1, deleted: true })!.deleted, true);
  assert.equal(mapLabel({ id: "", name: "x", color: 1, deleted: false }), null);
});

test("only a label on a whole chat is kept, not one on a single message", () => {
  assert.equal(isChatAssociation("label_jid"), true);
  assert.equal(isChatAssociation("label_message"), false);
});
