// Tests for imap/inbox-rows.ts: a stored message is gone when its UID is missing on the server or its folder was
// renumbered, and a message with no recorded UIDVALIDITY is never judged gone.

import { test } from "node:test";
import assert from "node:assert/strict";
import { currentRows, goneRows } from "./inbox-rows";

const row = (id: string, meta: object | null) => ({ id, provider_meta: meta });
const rows = [row("a", { uid: 1, uid_validity: 7 }), row("b", { uid: 2, uid_validity: 7 }), row("c", { uid: 3, uid_validity: 6 }), row("d", {})];

test("only rows under the current UIDVALIDITY are current", () => {
  const { current, uids } = currentRows(rows, 7);
  assert.deepEqual([...current].map((r) => r.id), ["a", "b"]);
  assert.deepEqual(uids, [1, 2]);
});

test("a row is gone when absent on the server or from an older UIDVALIDITY; unknown rows stay", () => {
  const { current } = currentRows(rows, 7);
  const gone = goneRows(rows, current, new Set([1]));
  assert.deepEqual(gone.map((r) => r.id), ["b", "c"]);
});
