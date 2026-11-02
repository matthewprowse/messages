// Tests for labels.ts: tidying names, handing out colours, putting labels on and taking them off threads, and saved view links.

import assert from "node:assert/strict";
import { test } from "node:test";
import { allWear, cleanName, isShowing, labelDot, linksByThread, nameTaken, nextColor, NAME_MAX, savedViewHref, suggestedViewName, withLabel, withoutLabel, type SavedView } from "./labels";

test("a typed name loses stray spaces, is cut to the limit, and an empty one is refused", () => {
  assert.equal(cleanName("  Client   X \n"), "Client X");
  assert.equal(cleanName("   "), null);
  assert.equal(cleanName("a".repeat(100))?.length, NAME_MAX);
});

test("names clash ignoring case, except with the label being renamed", () => {
  const labels = [{ id: "1", name: "Client X" }, { id: "2", name: "Quote Sent" }];
  assert.equal(nameTaken(labels, "client x"), true);
  assert.equal(nameTaken(labels, "client x", "1"), false);
  assert.equal(nameTaken(labels, "Waiting on Docs"), false);
});

test("new labels take the colour used least, never grey", () => {
  assert.equal(nextColor([]), "red");
  assert.equal(nextColor([{ color: "red" }]), "orange");
  assert.notEqual(nextColor([{ color: "gray" }]), "gray");
  assert.equal(labelDot("teal"), "bg-teal-500");
  assert.equal(labelDot("not-a-colour"), "bg-gray-500");
});

test("labels are put on several threads at once and taken off again", () => {
  const start = linksByThread([{ thread_id: "a", label_id: "x" }, { thread_id: "a", label_id: "y" }, { thread_id: "b", label_id: "x" }]);
  assert.deepEqual(start.get("a"), ["x", "y"]);
  const on = withLabel(start, ["b", "c"], "y", true);
  assert.deepEqual(on.get("c"), ["y"]);
  assert.deepEqual(on.get("b"), ["x", "y"]);
  assert.equal(allWear(on, ["a", "b", "c"], "y"), true);
  assert.equal(allWear(on, ["a", "b", "c"], "x"), false);
  assert.equal(allWear(on, [], "x"), false);
  const off = withLabel(on, ["a", "b", "c"], "y", false);
  assert.equal(off.has("c"), false); // a thread with no labels left has no entry
  assert.deepEqual(off.get("a"), ["x"]);
  assert.deepEqual(start.get("b"), ["x"]); // the original is untouched, so Undo can restore it
});

test("deleting a label removes it from every thread", () => {
  const links = linksByThread([{ thread_id: "a", label_id: "x" }, { thread_id: "a", label_id: "y" }, { thread_id: "b", label_id: "x" }]);
  const left = withoutLabel(links, "x");
  assert.deepEqual([...left], [["a", ["y"]]]);
});

test("a saved view opens the Inbox with its view, filter and label, and is shown as active only when all match", () => {
  const v: SavedView = { id: "1", name: "Chasing", view: "priority", filter: "unread", labelId: "x" };
  assert.equal(savedViewHref(v), "/inbox?view=priority&filter=unread&label=x");
  assert.equal(savedViewHref({ id: "2", name: "Plain", view: "all", filter: "none" }), "/inbox");
  assert.equal(isShowing(v, "priority", "unread", "x"), true);
  assert.equal(isShowing(v, "priority", "unread", undefined), false);
  assert.equal(isShowing({ ...v, labelId: undefined }, "priority", "unread", undefined), true);
});

test("a suggested name joins the parts that are set", () => {
  assert.equal(suggestedViewName("Priority", "Unread", "Client X"), "Priority, Unread, Client X");
  assert.equal(suggestedViewName("All", undefined, "Client X"), "All, Client X");
});
