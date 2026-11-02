// Tests for lib/attachment-pages.ts: one stable order, the keyset filter, merging pages and refreshing a loaded list's top.

import { test } from "node:test";
import assert from "node:assert/strict";
import { afterCursorFilter, compareFiles, cursorOf, mergePages, refreshHead } from "./attachment-pages";
import type { FiledAttachment } from "./types";

const file = (id: string, sentAt: string) => ({ id, sentAt, name: id }) as FiledAttachment;

test("files are newest first and files sent at the same moment are ordered by id, the same every time", () => {
  const list = [file("a", "2026-10-01T10:00:00Z"), file("c", "2026-10-02T10:00:00Z"), file("b", "2026-10-02T10:00:00Z")];
  assert.deepEqual(list.sort(compareFiles).map((f) => f.id), ["c", "b", "a"]);
  assert.equal(compareFiles(file("a", "2026-10-02T12:00:00+02:00"), file("a", "2026-10-02T10:00:00Z")), 0); // the same moment in two spellings
});

test("the next page is everything after the cursor: older, or the same moment with a smaller id", () => {
  const c = cursorOf(file("f5", "2026-10-02T10:00:00+00:00"));
  assert.equal(afterCursorFilter(c), 'sent_at.lt."2026-10-02T10:00:00+00:00",and(sent_at.eq."2026-10-02T10:00:00+00:00",id.lt.f5)');
});

test("merging keeps each file once, in order, and a newer copy of a file wins", () => {
  const merged = mergePages([file("a", "2026-10-01T00:00:00Z"), file("b", "2026-09-01T00:00:00Z")], [{ ...file("a", "2026-10-01T00:00:00Z"), name: "renamed" }, file("c", "2026-11-01T00:00:00Z")]);
  assert.deepEqual(merged.map((f) => f.id), ["c", "a", "b"]);
  assert.equal(merged[1].name, "renamed");
});

test("a refresh whose page is the whole library replaces the list, dropping files that are gone", () => {
  const existing = [file("a", "2026-10-03T00:00:00Z"), file("b", "2026-10-02T00:00:00Z")];
  assert.deepEqual(refreshHead(existing, [file("b", "2026-10-02T00:00:00Z"), file("n", "2026-10-04T00:00:00Z")], 5).map((f) => f.id), ["n", "b"]);
});

test("a refresh with a full page replaces the top, drops a file hidden meanwhile, and keeps the older pages", () => {
  const existing = [file("e", "2026-10-05T00:00:00Z"), file("d", "2026-10-04T00:00:00Z"), file("c", "2026-10-03T00:00:00Z"), file("b", "2026-10-02T00:00:00Z"), file("a", "2026-10-01T00:00:00Z")];
  // A new file arrived (n) and d was hidden: the first page of 3 is n, e, c.
  const page = [file("n", "2026-10-06T00:00:00Z"), file("e", "2026-10-05T00:00:00Z"), file("c", "2026-10-03T00:00:00Z")];
  assert.deepEqual(refreshHead(existing, page, 3).map((f) => f.id), ["n", "e", "c", "b", "a"]);
});
