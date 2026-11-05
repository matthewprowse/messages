// The bulk bar's Label button (label-menu-button.tsx): every label as a tick that shows whether all the chosen
// conversations wear it and puts it on or takes it off all of them, then New Label or Manage Labels.

import { test } from "node:test";
import assert from "node:assert/strict";
import { screen } from "@testing-library/react";
import { LabelMenuButton } from "./label-menu-button";
import { ManageLabelsHost } from "./manage-labels-dialog";
import { argsOf, spyLabels } from "@/test/fake-store";
import { renderScreen } from "@/test/render";
import { KITCHEN, LABELS, LEASE } from "@/test/fixtures";

const IDS = [KITCHEN.id, LEASE.id];

test("a label worn by every chosen conversation is ticked; unticking takes it off them all", async () => {
  const labels = spyLabels(LABELS, { [KITCHEN.id]: ["label-clients"], [LEASE.id]: ["label-clients"] });
  const { user } = renderScreen(<LabelMenuButton ids={IDS} />, { overrides: { labels } });
  await user.click(screen.getByRole("button", { name: "Label" }));
  const clients = await screen.findByRole("menuitemcheckbox", { name: "Clients" });
  assert.equal(clients.getAttribute("aria-checked"), "true");
  await user.click(clients);
  assert.deepEqual(argsOf(labels.setLabel), [[IDS, "label-clients", false]]);
});

test("a label only some wear is not ticked, and ticking puts it on all of them", async () => {
  const labels = spyLabels(LABELS, { [KITCHEN.id]: ["label-invoices"] });
  const { user } = renderScreen(<LabelMenuButton ids={IDS} />, { overrides: { labels } });
  await user.click(screen.getByRole("button", { name: "Label" }));
  const invoices = await screen.findByRole("menuitemcheckbox", { name: "Invoices" });
  assert.equal(invoices.getAttribute("aria-checked"), "false");
  await user.click(invoices);
  assert.deepEqual(argsOf(labels.setLabel), [[IDS, "label-invoices", true]]);
});

test("with no labels yet the menu offers New Label, which opens the dialog", async () => {
  const { user } = renderScreen(<><LabelMenuButton ids={IDS} /><ManageLabelsHost /></>);
  await user.click(screen.getByRole("button", { name: "Label" }));
  assert.equal(screen.queryByRole("menuitemcheckbox"), null);
  await user.click(await screen.findByRole("menuitem", { name: "New Label" }));
  assert.ok(await screen.findByRole("dialog", { name: "Labels" }));
  assert.ok(screen.getByText("No labels yet. Name your first one below."));
});
