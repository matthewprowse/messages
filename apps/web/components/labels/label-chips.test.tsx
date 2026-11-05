// The label filter chips under the view buttons (label-chips.tsx): nothing until a label exists, one link per label that
// keeps the view and filter, the active one pressed and clearing itself, and Manage Labels opening the dialog.

import { test } from "node:test";
import assert from "node:assert/strict";
import { screen, within } from "@testing-library/react";
import { LabelChips } from "./label-chips";
import { ManageLabelsHost } from "./manage-labels-dialog";
import { renderScreen } from "@/test/render";
import { LABELS } from "@/test/fixtures";

test("no chips at all until a label exists", () => {
  renderScreen(<LabelChips view="all" filter="none" />);
  assert.equal(screen.queryByRole("group", { name: "Labels" }), null);
});

test("each label links to the list filtered by it, keeping the view and filter", () => {
  renderScreen(<LabelChips view="priority" filter="unread" />, { labels: LABELS });
  const group = screen.getByRole("group", { name: "Labels" });
  const clients = within(group).getByRole("link", { name: "Clients" });
  assert.equal(clients.getAttribute("href"), "/inbox?view=priority&filter=unread&label=label-clients");
  assert.equal(clients.getAttribute("aria-pressed"), "false");
});

test("the active label is pressed, and its link clears the filter", () => {
  renderScreen(<LabelChips view="all" filter="none" label="label-invoices" />, { labels: LABELS });
  const invoices = screen.getByRole("link", { name: "Invoices" });
  assert.equal(invoices.getAttribute("aria-pressed"), "true");
  assert.equal(invoices.getAttribute("href"), "/inbox");
});

test("Manage Labels opens the Labels dialog", async () => {
  const { user } = renderScreen(<><LabelChips view="all" filter="none" /><ManageLabelsHost /></>, { labels: LABELS });
  await user.click(screen.getByRole("button", { name: "Manage Labels" }));
  assert.ok(await screen.findByRole("dialog", { name: "Labels" }));
});
