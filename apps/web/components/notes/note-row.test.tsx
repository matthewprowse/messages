// The note row in the Notes list (notes/note-row.tsx): what it says (title, preview, checklist progress, pinned, drafts),
// the search highlight, the row actions and right-click menu, and warming the note before it is opened.

import { mock, test } from "node:test";
import assert from "node:assert/strict";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import type { Note } from "@/lib/notes";
import type { DraftsStatus } from "@/components/note-drafts-badge";
import { NoteRow } from "./note-row";
import { renderScreen } from "@/test/render";
import { note } from "@/test/contacts-fixtures";

/** One row with every callback a spy. */
function renderRow(n: Note = note("note-1"), { term = "", drafts = "off" as DraftsStatus, selected = false } = {}) {
  const spies = { onSwipe: mock.fn(), onTouchRow: mock.fn(), onPin: mock.fn(), onDelete: mock.fn(), onDraft: mock.fn(), onArchive: mock.fn(), onWarm: mock.fn() };
  const s = renderScreen(<NoteRow note={n} drafts={drafts} term={term} today="2026-11-04" selected={selected} open={false} {...spies} />, { path: "/notes" });
  return { ...s, ...spies };
}

const link = () => screen.getByRole("link");
const noteArg = (fn: ReturnType<typeof mock.fn>) => (fn.mock.calls[0]?.arguments[0] as Note | undefined)?.id;

test("the row shows the title and the start of the text, and opens the note", () => {
  renderRow();
  assert.equal(link().getAttribute("href"), "/notes/note-1");
  assert.ok(within(link()).getByText("Site Visit Checklist"));
  assert.ok(within(link()).getByText("Measure the kitchen walls before Thursday."));
});

test("a blank note reads Untitled Note and No Text", () => {
  renderRow(note("note-blank", { title: " ", body: "" }));
  assert.ok(screen.getByText("Untitled Note"));
  assert.ok(screen.getByText("No Text"));
});

test("a checklist shows how much is done, and a pinned note says Pinned", () => {
  renderRow(note("note-list", { pinned: true, body: "- [x] Measure walls\n- [ ] Order tiles\n- [ ] Book plumber" }));
  assert.equal(screen.getByLabelText("1 of 3 done").textContent, "1/3");
  assert.ok(screen.getByLabelText("Pinned"));
  assert.equal(link().getAttribute("data-pinned"), "true");
});

test("while searching the row shows the matching line with the words marked", () => {
  const { container } = renderRow(note("note-search", { body: "First line about walls.\nThe oak worktops arrive on Friday." }), { term: "oak" });
  const marks = [...container.querySelectorAll("mark")].map((m) => m.textContent);
  assert.deepEqual(marks, ["oak"]);
  assert.ok(screen.getByText(/worktops arrive on Friday/));
});

test("a note given to drafts says so, and one that does not fit says it is left out", () => {
  const { unmount } = renderRow(note("note-used", { useInDrafts: true }), { drafts: "used" });
  assert.ok(screen.getByText("Used in Drafts"));
  unmount();
  renderRow(note("note-out", { useInDrafts: true }), { drafts: "left-out" });
  assert.ok(screen.getByText("Left Out of Drafts"));
});

test("the open note's row is marked as the current page", () => {
  renderRow(note("note-open"), { selected: true });
  assert.equal(link().getAttribute("aria-current"), "page");
});

test("Pin, Archive and Delete each act on this note", async () => {
  const { user, onPin, onArchive, onDelete } = renderRow(note("note-act"));
  await user.click(screen.getByRole("button", { name: "Pin" }));
  await user.click(screen.getByRole("button", { name: "Archive" }));
  await user.click(screen.getByRole("button", { name: "Delete" }));
  assert.deepEqual([noteArg(onPin), noteArg(onArchive), noteArg(onDelete)], ["note-act", "note-act", "note-act"]);
});

test("a pinned, archived note offers Unpin and Restore instead", () => {
  renderRow(note("note-done", { pinned: true, archived: true }));
  assert.ok(screen.getByRole("button", { name: "Unpin" }));
  assert.ok(screen.getByRole("button", { name: "Restore" }));
});

test("the right-click menu turns Use in Drafts on for this note", async () => {
  const { user, onDraft } = renderRow(note("note-menu"));
  fireEvent.contextMenu(link());
  const item = await screen.findByRole("menuitemcheckbox", { name: "Use in Drafts" });
  assert.equal(item.getAttribute("aria-checked"), "false");
  await user.click(item);
  assert.equal(noteArg(onDraft), "note-menu");
});

test("resting the pointer on a row warms the note, but passing over it does not", async () => {
  const { onWarm } = renderRow(note("note-warm"));
  fireEvent.pointerEnter(link());
  fireEvent.pointerLeave(link());
  await new Promise((r) => setTimeout(r, 200));
  assert.equal(onWarm.mock.callCount(), 0);
  fireEvent.pointerEnter(link());
  await waitFor(() => assert.deepEqual(onWarm.mock.calls.map((c) => c.arguments), [["note-warm"]]));
});

test("focusing the row with the keyboard warms the note at once", () => {
  const { onWarm } = renderRow(note("note-focus"));
  link().focus();
  assert.deepEqual(onWarm.mock.calls.map((c) => c.arguments), [["note-focus"]]);
});
