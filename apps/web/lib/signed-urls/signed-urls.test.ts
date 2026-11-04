// Tests for the pure parts of lib/signed-urls/: cache keys and freshness (cache-rules.ts), path reading
// (sealed-paths.ts) and the byte helpers for partial downloads (chunks.ts).

import { test } from "node:test";
import assert from "node:assert/strict";
import { FIELD } from "@messages/crypto/fields";
import { fresh, keyOf, type Entry } from "./cache-rules";
import { isBrowserSealedPath, isNotePath, isOutboxPath, isTeamFilePath, sealedField } from "./sealed-paths";
import { headOf, joinChunks } from "./chunks";

const entry = (over: Partial<Entry>): Entry => ({ url: Promise.resolve("u"), expires: 0, ...over });

test("a thumbnail is keyed apart from the original of the same file", () => {
  assert.notEqual(keyOf("b", "p", true), keyOf("b", "p"));
  assert.equal(keyOf("b", "p"), "b\np");
});

test("a link is reused only while it has more than the asked headroom left", () => {
  const e = entry({ value: "u", expires: 10_000 });
  assert.equal(fresh(e, 3_000, 5_000), true);
  assert.equal(fresh(e, 5_000, 5_000), false);
  assert.equal(fresh(undefined, 0, 0), false);
});

test("a remembered failure is honoured until its retry time", () => {
  const failed = entry({ value: null, expires: 8_000 });
  assert.equal(fresh(failed, 999_999, 5_000), true);
  assert.equal(fresh(failed, 0, 8_000), false);
});

test("note and team paths are told apart, and each has its sealing field", () => {
  assert.equal(isNotePath("user/notes/n1/f1"), true);
  assert.equal(isNotePath("user/other/n1/f1"), false);
  assert.equal(isNotePath(undefined), false);
  assert.equal(isTeamFilePath("team/w1/a1"), true);
  assert.equal(isTeamFilePath("user/notes/n1/f1"), false);
  assert.equal(sealedField("user/notes/n1/f1"), FIELD.noteFileData);
  assert.equal(sealedField("user/thread/a1"), FIELD.attachmentData);
});

test("outgoing files are sealed by the browser under their own field, old named uploads included", () => {
  assert.equal(isOutboxPath("user/outbox/f1/file"), true);
  assert.equal(isOutboxPath("user/outbox/f1/Plan.pdf"), true);
  assert.equal(isOutboxPath("user/notes/n1/f1"), false);
  assert.equal(isBrowserSealedPath("user/outbox/f1/file"), true);
  assert.equal(isBrowserSealedPath("user/notes/n1/f1"), true);
  assert.equal(isBrowserSealedPath("user/thread/a1"), false);
  assert.equal(isBrowserSealedPath(undefined), false);
  assert.equal(sealedField("user/outbox/f1/file"), FIELD.outboxFileData);
});

test("the head spans pieces and stops at the asked size", () => {
  const chunks = [new Uint8Array([1, 2]), new Uint8Array([3, 4]), new Uint8Array([5])];
  assert.deepEqual([...headOf(chunks, 5, 3)], [1, 2, 3]);
  assert.deepEqual([...headOf(chunks, 2, 4)], [1, 2]);
});

test("pieces join end to end", () => {
  const chunks = [new Uint8Array([1, 2]), new Uint8Array([3]), new Uint8Array([4, 5])];
  assert.deepEqual([...joinChunks(chunks, 5)], [1, 2, 3, 4, 5]);
});
