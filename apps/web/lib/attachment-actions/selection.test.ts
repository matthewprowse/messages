// Tests for selection.ts: toggling, what the bar offers, and the Largest sort order.

import { test } from "node:test";
import assert from "node:assert/strict";
import { actionsFor, deleteWords, selectedFiles, selectedLabel, sortLargest, toggled } from "./selection";
import type { FiledAttachment } from "../types";

const f = (id: string, extra: Partial<FiledAttachment> = {}) => ({ id, name: id, kind: "file", size: "", messageId: "m", threadId: "t", sentAt: "2026-11-01T10:00:00Z", from: "me", ...extra }) as FiledAttachment;

test("toggling adds then removes, without changing the old set", () => {
  const a = new Set<string>();
  const b = toggled(a, "x");
  assert.deepEqual([...b], ["x"]);
  assert.equal(a.size, 0);
  assert.equal(toggled(b, "x").size, 0);
});

test("a selection keeps the shown order and drops files that left the list", () => {
  const items = [f("1"), f("2"), f("3")];
  assert.deepEqual(selectedFiles(items, new Set(["3", "1", "gone"])).map((x) => x.id), ["1", "3"]);
});

test("the bar counts stored files, skips the rest, and flips Hide to Unhide when all are hidden", () => {
  const a = actionsFor([f("1", { path: "p" }), f("2"), f("3", { path: "q", hiddenReason: "manual" })]);
  assert.deepEqual(a, { downloadable: 2, skipped: 1, hide: true, deletable: 2 });
  assert.equal(actionsFor([f("1", { path: "p", hiddenReason: "manual" })]).hide, false);
});

test("Largest puts the biggest first, unknown sizes last, ties newest first", () => {
  const out = sortLargest([f("a", { bytes: 5 }), f("b"), f("c", { bytes: 9 }), f("d", { bytes: 5, sentAt: "2026-11-02T10:00:00Z" })]);
  assert.deepEqual(out.map((x) => x.id), ["c", "d", "a", "b"]);
});

test("the count reads as a label", () => {
  assert.equal(selectedLabel(1200), "1,200 Selected");
});

test("the delete dialog names one file or counts several, and says the email stays", () => {
  assert.match(deleteWords([{ name: "a.pdf", path: "p" }]).body, /^Delete a\.pdf\?/);
  assert.match(deleteWords([{ name: "a", path: "p" }, { name: "b", path: "q" }, { name: "c" }]).body, /^Delete 2 Files\?/);
  assert.match(deleteWords([{ name: "a", path: "p" }]).body, /not touched/);
});
