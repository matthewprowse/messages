// The Delete Note dialog (notes/delete-note-dialog.tsx) over the real notes provider (notes-data.tsx) and the fake
// Supabase client: it names the note, Delete Note deletes that note's row and tells the caller, and Cancel deletes nothing.

import { mock, test } from "node:test";
import assert from "node:assert/strict";
import { screen, waitFor } from "@testing-library/react";
import { NotesProvider } from "@/components/notes-data";
import type { Note } from "@/lib/notes";
import { DeleteNoteDialog } from "./delete-note-dialog";
import { fakeSupabase } from "@/test/fake-supabase";
import { renderScreen } from "@/test/render";
import { note } from "@/test/contacts-fixtures";

function renderDialog(n: Note | null) {
  const onClose = mock.fn();
  const onDeleted = mock.fn();
  const s = renderScreen(<NotesProvider><DeleteNoteDialog note={n} onClose={onClose} onDeleted={onDeleted} /></NotesProvider>, { path: "/notes", auth: true });
  return { ...s, onClose, onDeleted };
}

/** The ids a delete on the notes table was aimed at. */
const deletedIds = () => fakeSupabase.callsTo("from:notes").filter((c) => c.steps.some((s) => s.name === "delete")).map((c) => c.steps.find((s) => s.name === "eq")?.args);

test("the dialog asks about the note by its title", () => {
  renderDialog(note("note-del-1"));
  assert.ok(screen.getByRole("alertdialog", { name: "Delete Site Visit Checklist?" }));
});

test("an untitled note is asked about as Untitled Note", () => {
  renderDialog(note("note-del-2", { title: "" }));
  assert.ok(screen.getByRole("alertdialog", { name: "Delete Untitled Note?" }));
});

test("Delete Note deletes that note and tells the caller first", async () => {
  const { user, onDeleted } = renderDialog(note("note-del-3"));
  await user.click(screen.getByRole("button", { name: "Delete Note" }));
  assert.equal(onDeleted.mock.callCount(), 1);
  await waitFor(() => assert.deepEqual(deletedIds(), [["id", "note-del-3"]]));
});

test("Cancel closes and deletes nothing", async () => {
  const { user, onClose, onDeleted } = renderDialog(note("note-del-4"));
  await user.click(screen.getByRole("button", { name: "Cancel" }));
  assert.equal(onClose.mock.callCount(), 1);
  assert.equal(onDeleted.mock.callCount(), 0);
  assert.deepEqual(deletedIds(), []);
});

test("with no note the dialog is closed", () => {
  renderDialog(null);
  assert.equal(screen.queryByRole("alertdialog"), null);
});
