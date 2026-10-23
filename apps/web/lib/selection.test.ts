import { test } from "node:test";
import assert from "node:assert/strict";
import { shortcutAction, toggleSelection } from "./selection";

const order = ["a", "b", "c", "d", "e"];

test("a click toggles one row", () => {
  assert.deepEqual(toggleSelection(order, [], "c", null, false), ["c"]);
  assert.deepEqual(toggleSelection(order, ["c", "a"], "c", "c", false), ["a"]);
});

test("a shift-click selects the rows in between, in list order", () => {
  assert.deepEqual(toggleSelection(order, ["b"], "d", "b", true), ["b", "c", "d"]);
  assert.deepEqual(toggleSelection(order, ["d"], "a", "d", true), ["a", "b", "c", "d"]);
  // Without an anchor on screen, shift-click is a plain click.
  assert.deepEqual(toggleSelection(order, [], "b", "gone", true), ["b"]);
});

test("rows no longer in the list drop out of the selection", () => {
  assert.deepEqual(toggleSelection(order, ["gone", "a"], "b", "a", false), ["a", "b"]);
});

test("maps keys to list actions", () => {
  const key = (k: string, mods: Partial<{ metaKey: boolean; ctrlKey: boolean; altKey: boolean }> = {}) =>
    shortcutAction({ key: k, metaKey: false, ctrlKey: false, altKey: false, ...mods });
  assert.equal(key("e"), "archive");
  assert.equal(key("#"), "trash");
  assert.equal(key("Delete"), "trash");
  assert.equal(key("!"), "junk");
  assert.equal(key("Backspace"), null);
  assert.equal(key("e", { metaKey: true }), null);
});
