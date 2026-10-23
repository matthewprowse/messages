import assert from "node:assert/strict";
import { test } from "node:test";
import { SIDE_FOLDER_FULL_SYNC_MS, sideFolderDue } from "./folder-status";

const status = { uidNext: 120, uidValidity: 7n, messages: 40 };
const synced = (at: number) => ({ status, syncedAt: at });

test("syncs a side folder only when its STATUS changed", () => {
  assert.equal(sideFolderDue(synced(0), { ...status }, 60_000), false);
  assert.equal(sideFolderDue(synced(0), { ...status, uidNext: 121 }, 60_000), true); // new mail
  assert.equal(sideFolderDue(synced(0), { ...status, messages: 39 }, 60_000), true); // mail removed
  assert.equal(sideFolderDue(synced(0), { ...status, uidValidity: 8n }, 60_000), true); // renumbered
});

test("syncs a side folder with no usable STATUS or none to compare with", () => {
  assert.equal(sideFolderDue(undefined, status, 0), true); // first check this session
  assert.equal(sideFolderDue(synced(0), null, 60_000), true); // STATUS failed
  assert.equal(sideFolderDue({ status: null, syncedAt: 0 }, status, 60_000), true);
  assert.equal(sideFolderDue(synced(0), { uidValidity: 7n, messages: 40 }, 60_000), true); // no UIDNEXT in the reply
});

test("syncs a side folder fully every ten minutes even when nothing changed", () => {
  assert.equal(sideFolderDue(synced(0), status, SIDE_FOLDER_FULL_SYNC_MS - 1), false);
  assert.equal(sideFolderDue(synced(0), status, SIDE_FOLDER_FULL_SYNC_MS), true);
});
