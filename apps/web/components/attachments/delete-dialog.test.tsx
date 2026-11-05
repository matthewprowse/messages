// The Delete Files dialog (attachments/delete-dialog.tsx): it counts only files Konva holds a copy of, says only that copy
// goes, confirms or cancels, and locks while the delete runs.

import { mock, test } from "node:test";
import assert from "node:assert/strict";
import { screen } from "@testing-library/react";
import type { FiledAttachment } from "@/lib/types";
import { DeleteFilesDialog } from "./delete-dialog";
import { renderScreen } from "@/test/render";

/** A stored file (with a path) unless told otherwise. */
const file = (id: string, stored = true): FiledAttachment => ({
  id, name: `${id}.pdf`, kind: "pdf", size: "120 KB", path: stored ? `files/${id}` : undefined, messageId: `m-${id}`, threadId: "thread-kitchen", sentAt: "2026-11-01T10:00:00Z", from: "contact-ava",
});

function renderDialog(files: FiledAttachment[] | null, busy = false) {
  const onCancel = mock.fn();
  const onConfirm = mock.fn();
  const s = renderScreen(<DeleteFilesDialog files={files} busy={busy} onCancel={onCancel} onConfirm={onConfirm} />, { path: "/attachments" });
  return { ...s, onCancel, onConfirm };
}

test("one stored file is Delete File, and the dialog says the emails keep theirs", () => {
  renderDialog([file("quote")]);
  assert.ok(screen.getByRole("dialog", { name: "Delete File" }));
  assert.ok(screen.getByText("Only Konva's copy is deleted. The emails and chats keep theirs."));
});

test("only files with a stored copy are counted", () => {
  renderDialog([file("a"), file("b"), file("c"), file("link", false)]);
  assert.ok(screen.getByRole("dialog", { name: "Delete 3 Files" }));
});

test("Delete confirms and Cancel cancels", async () => {
  const { user, onConfirm, onCancel } = renderDialog([file("quote")]);
  await user.click(screen.getByRole("button", { name: "Delete" }));
  assert.equal(onConfirm.mock.callCount(), 1);
  await user.click(screen.getByRole("button", { name: "Cancel" }));
  assert.equal(onCancel.mock.callCount(), 1);
});

test("while deleting both buttons are off and Delete reads Deleting", () => {
  renderDialog([file("quote")], true);
  assert.equal((screen.getByRole("button", { name: "Deleting" }) as HTMLButtonElement).disabled, true);
  assert.equal((screen.getByRole("button", { name: "Cancel" }) as HTMLButtonElement).disabled, true);
});

test("Escape cancels, but not while the delete runs", async () => {
  const { user, onCancel, unmount } = renderDialog([file("quote")]);
  await user.keyboard("{Escape}");
  assert.equal(onCancel.mock.callCount(), 1);
  unmount();
  const busy = renderDialog([file("quote")], true);
  await busy.user.keyboard("{Escape}");
  assert.equal(busy.onCancel.mock.callCount(), 0);
});

test("with no files the dialog is closed", () => {
  renderDialog(null);
  assert.equal(screen.queryByRole("dialog"), null);
});
