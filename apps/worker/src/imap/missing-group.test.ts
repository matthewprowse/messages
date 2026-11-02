// Tests for imap/missing-group.ts groupByFolder: messages are grouped by stored folder, and rows that cannot be fetched
// again (no folder, UID or UIDVALIDITY, or an older UIDVALIDITY than the folder's first row) are skipped.

import { test } from "node:test";
import assert from "node:assert/strict";
import { groupByFolder } from "./missing-group";

test("messages group by folder with their UID", () => {
  const groups = groupByFolder([
    { message_id: "m1", provider_meta: { folder: "INBOX", uid: 1, uid_validity: 5 } },
    { message_id: "m2", provider_meta: { folder: "INBOX", uid: 2, uid_validity: 5 } },
    { message_id: "m3", provider_meta: { folder: "Sent", uid: 9, uid_validity: 8 } },
  ]);
  assert.deepEqual([...groups.get("INBOX")!.messages], [[1, "m1"], [2, "m2"]]);
  assert.equal(groups.get("Sent")!.uidValidity, 8);
});

test("a row missing its folder, uid or uid_validity, or from another UIDVALIDITY, is left out", () => {
  const groups = groupByFolder([
    { message_id: "a", provider_meta: { uid: 1, uid_validity: 5 } },
    { message_id: "b", provider_meta: { folder: "INBOX", uid_validity: 5 } },
    { message_id: "c", provider_meta: { folder: "INBOX", uid: 3 } },
    { message_id: "d", provider_meta: { folder: "INBOX", uid: 4, uid_validity: 5 } },
    { message_id: "e", provider_meta: { folder: "INBOX", uid: 5, uid_validity: 6 } },
  ]);
  assert.deepEqual([...groups.get("INBOX")!.messages], [[4, "d"]]);
});
