// The bulk bar shown while conversations are checked (selection-bar.tsx): Select All and Deselect All, the count, each
// action passed up by name, the read action following whether any is unread, and the Label menu on the checked ones.

import { mock, test } from "node:test";
import assert from "node:assert/strict";
import { screen } from "@testing-library/react";
import { BulkBar, SelectionBar } from "./selection-bar";
import { argsOf, spyLabels } from "@/test/fake-store";
import { renderScreen } from "@/test/render";
import { KITCHEN, LABELS, LEASE } from "@/test/fixtures";

function renderBar(props: { allPicked?: boolean; anyUnread?: boolean; count?: number; done?: boolean } = {}) {
  const labels = spyLabels(LABELS, { [KITCHEN.id]: ["label-clients"], [LEASE.id]: ["label-clients", "label-invoices"] });
  const onAll = mock.fn(), onClear = mock.fn(), onDone = mock.fn();
  const onAction = mock.fn((_a: string) => undefined);
  const s = renderScreen(
    <SelectionBar allPicked={props.allPicked ?? false} count={props.count ?? 2} anyUnread={props.anyUnread ?? false} ids={[KITCHEN.id, LEASE.id]}
      onAll={onAll} onClear={onClear} onDone={props.done ? onDone : undefined} onAction={onAction} />,
    { overrides: { labels } },
  );
  return { ...s, labels, onAll, onClear, onDone, onAction };
}

test("each action button passes its action up", async () => {
  const { user, onAction } = renderBar();
  for (const name of ["Archive", "Delete", "Move to Junk", "Snooze", "Mark as Unread"]) await user.click(screen.getByRole("button", { name }));
  assert.deepEqual(onAction.mock.calls.map((c) => c.arguments[0]), ["archive", "trash", "junk", "snooze", "read"]);
});

test("the read button says Mark as Read when any checked one is unread", () => {
  renderBar({ anyUnread: true });
  assert.ok(screen.getByRole("button", { name: "Mark as Read" }));
  assert.equal(screen.queryByRole("button", { name: "Mark as Unread" }), null);
});

test("Select All picks everything, and once all are picked the same button clears them", async () => {
  const first = renderBar();
  assert.ok(screen.getByText("2 Selected"));
  await first.user.click(screen.getByRole("button", { name: "Select All" }));
  assert.equal(first.onAll.mock.callCount(), 1);
  first.unmount();
  const second = renderBar({ allPicked: true, count: 4 });
  assert.ok(screen.getByText("All 4 Selected"));
  await second.user.click(screen.getByRole("button", { name: "Deselect All" }));
  assert.equal(second.onClear.mock.callCount(), 1);
});

test("the X ends select mode when there is one, and only unchecks otherwise", async () => {
  const first = renderBar({ done: true });
  await first.user.click(screen.getByRole("button", { name: "Done Selecting" }));
  assert.equal(first.onDone.mock.callCount(), 1);
  first.unmount();
  const second = renderBar();
  await second.user.click(screen.getByRole("button", { name: "Clear Selection" }));
  assert.equal(second.onClear.mock.callCount(), 1);
});

test("the Label menu ticks a label only when every checked conversation wears it, and toggles it on all of them", async () => {
  const { user, labels } = renderBar();
  await user.click(screen.getByRole("button", { name: "Label" }));
  const clients = await screen.findByRole("menuitemcheckbox", { name: "Clients" });
  const invoices = screen.getByRole("menuitemcheckbox", { name: "Invoices" });
  assert.equal(clients.getAttribute("aria-checked"), "true");
  assert.equal(invoices.getAttribute("aria-checked"), "false");
  await user.click(invoices);
  assert.deepEqual(argsOf(labels.setLabel), [[[KITCHEN.id, LEASE.id], "label-invoices", true]]);
  // The menu stays open, so several labels can be ticked in one go.
  assert.ok(screen.getByRole("menuitem", { name: "Manage Labels" }));
});

test("a plain BulkBar shows whatever actions it is given", () => {
  renderScreen(<BulkBar allPicked={false} onAll={() => undefined} onClear={() => undefined}><button type="button">Unsubscribe</button></BulkBar>);
  assert.ok(screen.getByRole("button", { name: "Unsubscribe" }));
  assert.ok(screen.getByRole("button", { name: "Clear Selection" }));
});
