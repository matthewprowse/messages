// Tests for note-merge.ts and note-facts.ts: how a refreshed list folds into the one on screen (edits, remote changes,
// a read that is older than our own save, new notes not yet written) and which notes reach drafts under the limits.

import { test } from "node:test";
import assert from "node:assert/strict";
import type { Note } from "./notes";
import { mergeLoaded } from "./note-merge";
import { FACT_NOTES, FACT_NOTE_CHARS, FACTS_CHARS, draftFacts, factStatus } from "./note-facts";

const note = (over: Partial<Note> = {}): Note => ({ id: "a", title: "T", body: "", excerpt: "ex", unloaded: true, pinned: false, useInDrafts: false, createdAt: "c", updatedAt: "2026-01-01T00:00:00Z", serverAt: "2026-01-01T00:00:00Z", ...over });
const none = { isEditing: () => false, isCreating: () => false };

test("downloaded text is kept when the row has not moved, and the row's metadata is taken", () => {
  const prev = [note({ unloaded: false, body: "Text" })];
  const out = mergeLoaded(prev, [note({ pinned: true, excerpt: null })], none);
  assert.equal(out[0].body, "Text");
  assert.equal(out[0].unloaded, false);
  assert.equal(out[0].pinned, true);
  assert.equal(out[0].excerpt, "Text");
});

test("a row changed elsewhere comes back unopened so its new text is downloaded", () => {
  const prev = [note({ unloaded: false, body: "Old", serverAt: "2026-01-01T00:00:00Z" })];
  const out = mergeLoaded(prev, [note({ serverAt: "2026-01-02T00:00:00Z" })], none);
  assert.equal(out[0].unloaded, true);
  assert.equal(out[0].body, "");
  assert.equal(out[0].revision, 1);
});

test("a note being edited is left exactly as it is", () => {
  const prev = [note({ unloaded: false, body: "Typing", title: "Mine" })];
  const out = mergeLoaded(prev, [note({ serverAt: "2026-01-05T00:00:00Z", title: "Theirs" })], { ...none, isEditing: () => true });
  assert.equal(out[0], prev[0]);
});

test("rows read before our own latest save landed do not roll the note back", () => {
  const prev = [note({ unloaded: false, body: "New", serverAt: "2026-01-03T00:00:00Z" })];
  const out = mergeLoaded(prev, [note({ serverAt: "2026-01-02T00:00:00Z" })], none);
  assert.equal(out[0], prev[0]);
});

test("a failed note is tried again from the row", () => {
  const prev = [note({ failed: true })];
  const out = mergeLoaded(prev, [note()], none);
  assert.equal(out[0].failed, undefined);
  assert.equal(out[0].unloaded, true);
});

test("a note being made or edited but absent from the rows is kept; others are dropped", () => {
  const prev = [note({ id: "new" }), note({ id: "edit" }), note({ id: "gone" }), note({ id: "kept" })];
  const out = mergeLoaded(prev, [note({ id: "kept" })], { isEditing: (id) => id === "edit", isCreating: (id) => id === "new" });
  assert.deepEqual(out.map((n) => n.id).sort(), ["edit", "kept", "new"]);
});

const fact = (id: string, body: string, over: Partial<Parameters<typeof draftFacts>[0][number]> = {}) => ({ id, body, excerpt: null, unloaded: false, useInDrafts: true, ...over });

test("drafts take 15 notes in id order and the rest are left out", () => {
  const notes = Array.from({ length: 17 }, (_, i) => fact(`n${String(i).padStart(2, "0")}`, "fee"));
  const r = draftFacts(notes);
  assert.equal(r.marked, 17);
  assert.equal(r.used, FACT_NOTES);
  assert.deepEqual([...r.leftOut], ["n15", "n16"]);
  assert.equal(factStatus(r, notes[16]), "left-out");
  assert.equal(factStatus(r, notes[0]), "used");
});

test("a long note is cut to its share, and the shared limit leaves later notes out", () => {
  const long = "x".repeat(FACT_NOTE_CHARS + 10);
  const notes = ["a", "b", "c", "d", "e"].map((id) => fact(id, long));
  const r = draftFacts(notes);
  assert.ok(r.shortened.has("a"));
  assert.equal(factStatus(r, notes[0]), "cut");
  // Four notes of 1,500 characters fill the 6,000; the fifth does not fit.
  assert.equal(FACTS_CHARS, 4 * FACT_NOTE_CHARS);
  assert.equal(r.used, 4);
  assert.ok(r.leftOut.has("e"));
});

test("empty notes and unmarked notes are not counted, and an unopened note uses its excerpt", () => {
  const r = draftFacts([fact("a", "   "), fact("b", "", { unloaded: true, excerpt: "From the excerpt" }), fact("c", "text", { useInDrafts: false })]);
  assert.equal(r.marked, 2);
  assert.equal(r.used, 1);
  assert.ok(r.approximate);
  assert.equal(factStatus(r, { id: "c", useInDrafts: false }), "off");
});
