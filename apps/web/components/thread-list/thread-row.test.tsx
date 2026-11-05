// One conversation row (thread-row.tsx): who and what it shows (name, subject, unread count, the Urgent and Needs Reply
// tags, labels, pinned), that a click opens the conversation, and that pressing or resting on it starts the prefetch.

import { mock, test } from "node:test";
import assert from "node:assert/strict";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { ThreadRow } from "./thread-row";
import { renderScreen } from "@/test/render";
import { AVA, BEN, GARDEN, KITCHEN, LABELS, LEASE } from "@/test/fixtures";
import type { Contact, Thread } from "@/lib/types";
import type { Label } from "@/lib/labels";

/** One row with spies for everything it calls out to. */
function renderRow(thread: Thread, contact: Contact | undefined, extra: { labels?: Label[]; selecting?: boolean; checked?: boolean } = {}) {
  const onPress = mock.fn((_id: string) => undefined);
  const onCheck = mock.fn((_id: string, _range: boolean) => undefined);
  const onAction = mock.fn((_id: string, _action: string) => undefined);
  const s = renderScreen(
    <ThreadRow thread={thread} today="2026-11-04" contact={contact} query="" selected={false} checked={extra.checked ?? false} selecting={extra.selecting ?? false}
      onCheck={onCheck} onAction={onAction} onPress={onPress} labels={extra.labels} />,
  );
  return { ...s, onPress, onCheck, onAction };
}

const rowLink = () => screen.getByRole("link");

test("an unread email row shows the person, the subject and how many are unread", () => {
  renderRow(KITCHEN, AVA);
  assert.ok(screen.getByText("Ava Thompson"));
  assert.ok(screen.getByText("Kitchen Renovation Quote"));
  assert.ok(screen.getByLabelText("1 unread"));
});

test("a read row has no unread count", () => {
  renderRow(LEASE, BEN);
  assert.equal(screen.queryByLabelText(/unread$/), null);
});

test("an urgent conversation waiting on you is tagged Urgent, and one that needs an answer Needs Reply", () => {
  const { unmount } = renderRow(KITCHEN, AVA);
  assert.ok(screen.getByText("Urgent"));
  assert.equal(screen.queryByText("Needs Reply"), null);
  unmount();
  renderRow(LEASE, BEN);
  assert.ok(screen.getByText("Needs Reply"));
  assert.equal(screen.queryByText("Urgent"), null);
});

test("no tag once you wrote last: the conversation waits on them", () => {
  renderRow({ ...KITCHEN, lastFromMe: true }, AVA);
  assert.equal(screen.queryByText("Urgent"), null);
  assert.equal(screen.queryByText("Needs Reply"), null);
});

test("a chat row shows its latest message instead of a subject", () => {
  renderRow({ ...GARDEN, channel: "whatsapp", provider: "whatsapp", subject: "Ignored", preview: "See you at nine." }, AVA);
  assert.ok(screen.getByText("See you at nine."));
  assert.equal(screen.queryByText("Ignored"), null);
});

test("the first two labels are named and the rest counted", () => {
  const third: Label = { id: "label-third", name: "Follow Ups", color: "red" };
  renderRow(KITCHEN, AVA, { labels: [...LABELS, third] });
  assert.ok(screen.getByText("Clients"));
  assert.ok(screen.getByText("Invoices"));
  assert.equal(screen.queryByText("Follow Ups"), null);
  assert.ok(screen.getByText("+1"));
});

test("a pinned conversation is marked Pinned", () => {
  renderRow({ ...LEASE, pinned: true }, BEN);
  assert.ok(screen.getByLabelText("Pinned"));
});

test("the row links to the conversation, so a click opens it", async () => {
  const { user, onCheck } = renderRow(KITCHEN, AVA);
  assert.equal(rowLink().getAttribute("href"), `/inbox/${KITCHEN.id}`);
  await user.click(rowLink());
  // A plain click is left to the link: it neither checks the row nor is stopped.
  assert.equal(onCheck.mock.callCount(), 0);
});

test("pressing a row starts loading its messages before the click lands", () => {
  const { onPress } = renderRow(KITCHEN, AVA);
  fireEvent.pointerDown(rowLink());
  assert.deepEqual(onPress.mock.calls.map((c) => c.arguments), [[KITCHEN.id]]);
});

test("resting the mouse on a row prefetches the page and then the messages", async () => {
  const { router, onPress } = renderRow(KITCHEN, AVA);
  fireEvent.mouseEnter(rowLink());
  assert.deepEqual(router.prefetch.mock.calls.map((c) => c.arguments[0]), [`/inbox/${KITCHEN.id}`]);
  await waitFor(() => assert.equal(onPress.mock.callCount(), 1));
});

test("Cmd-click checks the row instead of opening it", async () => {
  const { user, onCheck } = renderRow(KITCHEN, AVA);
  await user.keyboard("{Meta>}");
  await user.click(rowLink());
  await user.keyboard("{/Meta}");
  assert.deepEqual(onCheck.mock.calls.map((c) => c.arguments), [[KITCHEN.id, false]]);
});

test("while selecting, a click checks the row", async () => {
  const { user, onCheck } = renderRow(KITCHEN, AVA, { selecting: true });
  await user.click(rowLink());
  assert.equal(onCheck.mock.callCount(), 1);
  assert.ok(screen.getByRole("checkbox", { name: "Select Ava Thompson" }));
});

test("the hover actions archive, snooze, delete and junk the conversation", async () => {
  const { user, onAction } = renderRow(KITCHEN, AVA);
  fireEvent.pointerEnter(rowLink().parentElement!);
  for (const name of ["Archive", "Snooze", "Delete", "Move to Junk"]) await user.click(screen.getByRole("button", { name }));
  assert.deepEqual(onAction.mock.calls.map((c) => c.arguments[1]), ["archive", "snooze", "trash", "junk"]);
});

test("the right-click menu marks it read and pins it", async () => {
  const { user, onAction } = renderRow(KITCHEN, AVA);
  fireEvent.contextMenu(rowLink());
  await user.click(await screen.findByRole("menuitem", { name: /Mark as Read/ }));
  fireEvent.contextMenu(rowLink());
  await user.click(await screen.findByRole("menuitem", { name: "Pin" }));
  assert.deepEqual(onAction.mock.calls.map((c) => c.arguments[1]), ["read", "pin"]);
});
