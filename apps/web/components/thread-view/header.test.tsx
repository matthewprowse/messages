// The conversation's top bar (header.tsx): the person and a link to their page, and the More menu, whose items reach the
// store (Pin, Mark as Read, Archive and Delete, which also leave the conversation, Snooze, Label, junk and importance).

import { mock, test } from "node:test";
import assert from "node:assert/strict";
import { screen } from "@testing-library/react";
import { ThreadHeader } from "./header";
import { argsOf, spyLabels } from "@/test/fake-store";
import { renderScreen, type ScreenOptions } from "@/test/render";
import { AVA, KITCHEN, LEASE } from "@/test/fixtures";
import { snoozeChoices } from "@/lib/snooze";
import type { Thread } from "@/lib/types";

function renderHeader(thread: Thread = KITCHEN, options: ScreenOptions = {}) {
  const onLeave = mock.fn(), onAttachments = mock.fn(), onForward = mock.fn();
  const s = renderScreen(
    <ThreadHeader thread={thread} primary={AVA} title="Ava Thompson" subtitle={thread.subject} backHref="/inbox" hrefFor={(id) => `/inbox/${id}`}
      forwardable onLeave={onLeave} onAttachments={onAttachments} onForward={onForward} />,
    { path: `/inbox/${thread.id}`, ...options },
  );
  return { ...s, onLeave, onAttachments, onForward };
}

/** Opens More and picks an item by keyboard, which works for items in submenus too. */
async function more(user: ReturnType<typeof renderScreen>["user"], name: string) {
  await user.click(screen.getByRole("button", { name: "More" }));
  (await screen.findByRole("menuitem", { name })).focus();
  await user.keyboard("{Enter}");
}

test("the person's name links to their contact page, and Back to the list", () => {
  renderHeader();
  assert.equal(screen.getByRole("link", { name: "View Ava Thompson" }).getAttribute("href"), `/contacts/${AVA.id}`);
  assert.equal(screen.getByRole("link", { name: "Back" }).getAttribute("href"), "/inbox");
  assert.ok(screen.getByText("Kitchen Renovation Quote"));
});

test("Pin and Mark as Read reach the store for this conversation", async () => {
  const { user, store } = renderHeader();
  await more(user, "Pin");
  await more(user, "Mark as Read");
  assert.deepEqual(argsOf(store.pin), [[KITCHEN.id, true]]);
  assert.deepEqual(argsOf(store.markRead), [[KITCHEN.id, true]]);
});

test("a read, pinned conversation offers Unpin and Mark as Unread instead", async () => {
  const { user, store } = renderHeader({ ...LEASE, pinned: true });
  await more(user, "Unpin");
  await more(user, "Mark as Unread");
  assert.deepEqual(argsOf(store.pin), [[LEASE.id, false]]);
  assert.deepEqual(argsOf(store.markRead), [[LEASE.id, false]]);
});

test("Archive and Delete act and then leave the conversation", async () => {
  const { user, store, onLeave } = renderHeader();
  await more(user, "Archive");
  await more(user, "Delete");
  assert.deepEqual(argsOf(store.archive), [[KITCHEN.id]]);
  assert.deepEqual(argsOf(store.trash), [[KITCHEN.id]]);
  assert.equal(onLeave.mock.callCount(), 2);
});

test("Snooze, Tomorrow snoozes it and moves on", async () => {
  const { user, store, onLeave } = renderHeader();
  await more(user, "Snooze");
  await user.keyboard("{ArrowRight}");
  (await screen.findByRole("menuitem", { name: "Tomorrow" })).focus();
  await user.keyboard("{Enter}");
  const [ids, at, kind] = argsOf(store.snooze)[0];
  assert.deepEqual(ids, [KITCHEN.id]);
  assert.equal((at as Date).getTime(), snoozeChoices(new Date()).find((c) => c.key === "tomorrow")!.at.getTime());
  assert.equal(kind, "snooze");
  assert.equal(onLeave.mock.callCount(), 1);
});

test("Label ticks a label on this conversation", async () => {
  const labels = spyLabels();
  const { user } = renderHeader(KITCHEN, { overrides: { labels } });
  await more(user, "Label");
  await user.keyboard("{ArrowRight}");
  (await screen.findByRole("menuitemcheckbox", { name: "Invoices" })).focus();
  await user.keyboard("{Enter}");
  assert.deepEqual(argsOf(labels.setLabel), [[[KITCHEN.id], "label-invoices", true]]);
});

test("importance and junk feedback go to the store", async () => {
  const { user, store } = renderHeader();
  await more(user, "Mark as Important");
  await more(user, "Mark as Not Important");
  await more(user, "Move to Junk");
  assert.deepEqual(argsOf(store.giveFeedback), [[KITCHEN.id, "important"], [KITCHEN.id, "not_important"]]);
  assert.deepEqual(argsOf(store.setJunk), [[KITCHEN.id, true]]);
});

test("Attachments and Forward open their dialogs", async () => {
  const { user, onAttachments, onForward } = renderHeader();
  await more(user, "Attachments");
  await more(user, "Forward");
  assert.equal(onAttachments.mock.callCount(), 1);
  assert.equal(onForward.mock.callCount(), 1);
});

test("Add Priority Rule links to the AI settings with the person's address", async () => {
  const { user } = renderHeader();
  await user.click(screen.getByRole("button", { name: "More" }));
  const link = await screen.findByRole("menuitem", { name: "Add Priority Rule" });
  assert.equal(link.getAttribute("href"), `/settings/ai?add=${encodeURIComponent(AVA.emails[0])}#priorities`);
});
