// Tests for packages/analytics/src/allowed.ts: free-form sources (dialog names, field names, empty-state titles) are
// recorded only when listed, so a lowercase name that reached an id or a title becomes "other" instead of being stored.

import test from "node:test";
import assert from "node:assert/strict";
import { cleanProps } from "./index";
import { dialogWord, emptyStateWord, fieldWord, guardProps } from "./allowed";

test("a dialog is recorded by its listed name, anything else as other", () => {
  assert.equal(dialogWord("compose"), "compose");
  assert.equal(dialogWord("New Event"), "new_event");
  assert.equal(dialogWord("thandi"), "other");
  assert.equal(dialogWord("Thandi Nkosi's Notes!"), undefined, "not a word at all");
  assert.equal(dialogWord(undefined), undefined);
});

test("a field is kept only when every part of its name is a known word", () => {
  assert.equal(fieldWord("compose-subject"), "compose_subject");
  assert.equal(fieldWord("icloud-reminders-apple-id"), "icloud_reminders_apple_id");
  assert.equal(fieldWord("jane"), "other");
  assert.equal(fieldWord("client-3f2a"), "other");
  assert.equal(fieldWord("sam_to"), "other");
});

test("an empty screen is recorded by its listed title only", () => {
  assert.equal(emptyStateWord("No Attachments"), "no_attachments");
  assert.equal(emptyStateWord("Sam Has No Notes"), "other");
});

test("guardProps puts dialog events and empty states through the lists before cleanProps", () => {
  const dialog = guardProps("dialog_close", { dialog: "sam", outcome: "submit", secs: 4, fields: ["compose-to", "jane", "jane", "Body Text"] });
  assert.deepEqual(cleanProps(dialog), { dialog: "other", outcome: "submit", secs: 4, fields: ["compose_to", "other", "body_text"] });
  assert.deepEqual(cleanProps(guardProps("empty_state", { what: "thandi" })), { what: "other" });
  assert.deepEqual(guardProps("screen_view", { a: 1 }), { a: 1 });
});
