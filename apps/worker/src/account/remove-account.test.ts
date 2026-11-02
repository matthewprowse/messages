// remove-account.ts: files are deleted with their account, except a file another account's attachment still uses.

import assert from "node:assert/strict";
import { test } from "node:test";
import { objectsToDelete, pathsOf, sharedCandidates, type FileRow } from "./remove-account";

const row = (id: string, accountId: string, storagePath: string | null, over: Partial<FileRow> = {}): FileRow => ({ id, accountId, storagePath, thumbPath: null, teamPath: null, ...over });

test("a row's own file, thumbnail and team copy all go", () => {
  const r = row("1", "a", "u/m/1", { thumbPath: "u/m/1.t", teamPath: "team/w/1" });
  assert.deepEqual(objectsToDelete([r], []), ["team/w/1", "u/m/1", "u/m/1.t"]);
});

test("a deduped file stays while another account's attachment still points at it", () => {
  const mine = [row("1", "a", "u/m/shared"), row("2", "a", "u/m/only-mine")];
  const other = [row("9", "b", "u/n/x", { thumbPath: "u/m/shared" }), row("8", "b", "u/m/shared")];
  assert.deepEqual(objectsToDelete(mine, other), ["u/m/only-mine"]);
});

test("two rows of the removed account sharing one file delete it once", () => {
  assert.deepEqual(objectsToDelete([row("1", "a", "u/m/s"), row("2", "a", "u/m/s")], []), ["u/m/s"]);
});

test("rows with no stored file add nothing", () => {
  assert.deepEqual(pathsOf(row("1", "a", null)), []);
  assert.deepEqual(objectsToDelete([row("1", "a", null)], []), []);
});

test("the lookup candidates are each path once", () => {
  assert.deepEqual(sharedCandidates([row("1", "a", "p"), row("2", "a", "p", { thumbPath: "q" })]).sort(), ["p", "q"]);
});
