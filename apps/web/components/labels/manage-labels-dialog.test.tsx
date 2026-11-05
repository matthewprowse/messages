// The Labels dialog (manage-labels-dialog.tsx): opened from anywhere, it adds a label, renames one on blur (putting the
// name back when the store refuses it), recolours one, and deletes one only after a second click.

import { test } from "node:test";
import assert from "node:assert/strict";
import { act, screen, waitFor, within } from "@testing-library/react";
import { ManageLabelsHost, openManageLabels } from "./manage-labels-dialog";
import { argsOf, spyLabels } from "@/test/fake-store";
import { renderScreen } from "@/test/render";

/** The dialog with spy labels, already open. */
async function renderOpen(labels = spyLabels()) {
  const s = renderScreen(<ManageLabelsHost />, { overrides: { labels } });
  act(() => openManageLabels());
  const dialog = await screen.findByRole("dialog", { name: "Labels" });
  return { ...s, labels, dialog };
}

test("Add makes a label from the typed name and empties the box", async () => {
  const { user, labels, dialog } = await renderOpen();
  const add = within(dialog).getByRole("button", { name: "Add" }) as HTMLButtonElement;
  assert.equal(add.disabled, true);
  const box = within(dialog).getByRole("textbox", { name: "New Label" }) as HTMLInputElement;
  await user.type(box, "Suppliers{Enter}");
  assert.deepEqual(argsOf(labels.createLabel), [["Suppliers"]]);
  await waitFor(() => assert.equal(box.value, ""));
});

test("a label renamed and left saves the new name", async () => {
  const { user, labels, dialog } = await renderOpen();
  const [first] = within(dialog).getAllByRole("textbox", { name: "Label Name" });
  await user.clear(first);
  await user.type(first, "Key Clients{Enter}");
  assert.deepEqual(argsOf(labels.updateLabel), [["label-clients", { name: "Key Clients" }]]);
});

test("a rename the store refuses (a taken name) puts the old name back", async () => {
  const labels = spyLabels();
  labels.updateLabel.mock.mockImplementation(async () => false);
  const { user, dialog } = await renderOpen(labels);
  const [first] = within(dialog).getAllByRole("textbox", { name: "Label Name" }) as HTMLInputElement[];
  await user.clear(first);
  await user.type(first, "Invoices{Enter}");
  await waitFor(() => assert.equal(first.value, "Clients"));
});

test("an unchanged name saves nothing", async () => {
  const { user, labels, dialog } = await renderOpen();
  const [first] = within(dialog).getAllByRole("textbox", { name: "Label Name" });
  await user.click(first);
  await user.keyboard("{Enter}");
  assert.equal(labels.updateLabel.mock.callCount(), 0);
});

test("picking a colour recolours the label", async () => {
  const { user, labels, dialog } = await renderOpen();
  await user.click(within(dialog).getByRole("combobox", { name: "Colour of Invoices" }));
  await user.click(await screen.findByRole("option", { name: "Violet" }));
  assert.deepEqual(argsOf(labels.updateLabel), [["label-invoices", { color: "violet" }]]);
});

test("Delete asks once more before the label goes", async () => {
  const { user, labels, dialog } = await renderOpen();
  await user.click(within(dialog).getByRole("button", { name: "Delete Clients" }));
  assert.equal(labels.deleteLabel.mock.callCount(), 0);
  await user.click(within(dialog).getByRole("button", { name: "Delete" }));
  assert.deepEqual(argsOf(labels.deleteLabel), [["label-clients"]]);
});

test("with labels, the Auto Labels part lets each be described", async () => {
  const { dialog } = await renderOpen();
  assert.ok(within(dialog).getByText("Auto Labels"));
  const auto = within(dialog).getByRole("switch", { name: "Auto for Clients" }) as HTMLButtonElement;
  // Auto needs a description first.
  assert.equal(auto.disabled, true);
});
