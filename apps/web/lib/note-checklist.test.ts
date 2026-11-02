// Tests for pulling unchecked checklist items out of a note.
import assert from "node:assert/strict";
import { test } from "node:test";
import { taskNotesFrom, uncheckedItems } from "./note-checklist";

test("only unchecked items are taken, in order", () => {
  const md = "# Call\n- [ ] Send quote\n- [x] Book venue\n- [X] Done too\n* [ ] Call back\n1. [ ] Numbered one\nplain line";
  assert.deepEqual(uncheckedItems(md), ["Send quote", "Call back", "Numbered one"]);
});

test("nested items, links and emphasis are tidied", () => {
  assert.deepEqual(uncheckedItems("- [ ] Review\n  - [ ] **Sign** the [contract](https://x.test) &amp; return"), ["Review", "Sign the contract & return"]);
});

test("empty items, repeats and fenced code are skipped", () => {
  const md = "- [ ] \n- [ ] Same\n- [ ] same\n```\n- [ ] in code\n```\n- [ ] After";
  assert.deepEqual(uncheckedItems(md), ["Same", "After"]);
});

test("a very long item is cut to the task title limit", () => {
  const [item] = uncheckedItems(`- [ ] ${"a".repeat(600)}`);
  assert.equal(item.length, 500);
  assert.ok(item.endsWith("…"));
});

test("a note with no checklist gives nothing", () => {
  assert.deepEqual(uncheckedItems("Just text\n- plain bullet"), []);
});

test("task notes say where the task came from", () => {
  assert.equal(taskNotesFrom("Kickoff", "Thandi"), 'From the note "Kickoff" for Thandi.');
  assert.equal(taskNotesFrom("  "), 'From the note "Untitled Note".');
});
