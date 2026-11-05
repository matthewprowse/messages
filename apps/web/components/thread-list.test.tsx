// The Inbox list (thread-list.tsx) as the inbox page renders it: rows from the store's listThreads for the view and filter
// in the address, search and the label filter narrowing them, the empty states, select mode with the bulk actions, and
// the press that starts loading a conversation.

import { test } from "node:test";
import assert from "node:assert/strict";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { ThreadList } from "./thread-list";
import { argsOf } from "@/test/fake-store";
import { renderScreen, type ScreenOptions } from "@/test/render";
import { ACCOUNT, GARDEN, KITCHEN, LABELS, LEASE } from "@/test/fixtures";

const renderList = (options: ScreenOptions = {}) => renderScreen(<ThreadList />, { path: "/inbox", ...options });
/** The names on the rows, top to bottom. */
const rowNames = () => screen.queryAllByRole("link").filter((a) => a.hasAttribute("data-row-link")).map((a) => a.querySelector(".font-medium")?.textContent);

test("All lists every inbox conversation, newest first, by the person's name", () => {
  const { store } = renderList();
  assert.deepEqual(argsOf(store.listThreads)[0], ["all", "none"]);
  assert.deepEqual(rowNames(), ["Ava Thompson", "Ben Carter", "Chloe Naidoo", "Chloe Naidoo"]);
});

test("the view and filter come from the address", () => {
  const { store } = renderList({ path: "/inbox?view=priority&filter=unread" });
  assert.ok(argsOf(store.listThreads).some(([v, f]) => v === "priority" && f === "unread"));
  // Only the urgent, unread kitchen conversation is unread in Priority.
  assert.deepEqual(rowNames(), ["Ava Thompson"]);
});

test("searching narrows the rows to the matching conversations", async () => {
  const { user } = renderList();
  await user.type(screen.getByPlaceholderText("Search Conversations"), "renewal");
  await waitFor(() => assert.deepEqual(rowNames(), ["Ben Carter"]));
});

test("a search with no match says so", async () => {
  const { user } = renderList();
  await user.type(screen.getByPlaceholderText("Search Conversations"), "zebra crossing");
  assert.ok(await screen.findByText("No Matches"));
});

test("a label in the address shows only the conversations wearing it", () => {
  renderList({ path: "/inbox?label=label-clients", labels: LABELS, wearing: { [LEASE.id]: ["label-clients"] } });
  assert.deepEqual(rowNames(), ["Ben Carter"]);
});

test("a label nobody wears shows its own empty state", () => {
  renderList({ path: "/inbox?label=label-invoices", labels: LABELS });
  assert.ok(screen.getByText("Nothing With This Label"));
});

test("with no account connected the list offers to connect one", () => {
  renderList({ threads: [], accounts: [] });
  const link = screen.getByRole("link", { name: "Connect an Account" });
  assert.equal(link.getAttribute("href"), "/settings/accounts");
});

test("an empty view with an account says it is empty instead", () => {
  renderList({ threads: [], accounts: [ACCOUNT], path: "/inbox?filter=unread" });
  assert.ok(screen.getByText("Nothing Unread"));
});

test("pressing a row starts loading that conversation's messages", () => {
  const { store } = renderList();
  const row = screen.getAllByRole("link").find((a) => a.getAttribute("href") === `/inbox/${GARDEN.id}`)!;
  fireEvent.pointerDown(row);
  assert.deepEqual(argsOf(store.prefetchMessages)[0], [GARDEN.id]);
});

test("Select shows checkboxes; checking rows and Archive archives just those", async () => {
  const { user, store } = renderList();
  await user.click(screen.getByRole("button", { name: "Select" }));
  await user.click(screen.getByRole("checkbox", { name: "Select Ava Thompson" }));
  await user.click(screen.getByRole("checkbox", { name: "Select Ben Carter" }));
  assert.ok(screen.getByText("2 Selected"));
  await user.click(screen.getByRole("button", { name: "Archive" }));
  assert.deepEqual(argsOf(store.archive)[0], [[KITCHEN.id, LEASE.id]]);
});

test("Select All then Mark as Read marks every unread one read", async () => {
  const { user, store } = renderList();
  await user.click(screen.getByRole("button", { name: "Select" }));
  await user.click(screen.getByRole("button", { name: "Select All" }));
  assert.ok(screen.getByRole("button", { name: "Deselect All" }));
  await user.click(screen.getByRole("button", { name: "Mark as Read" }));
  assert.deepEqual(argsOf(store.markRead), [[KITCHEN.id, true]]);
});

test("Done leaves select mode and brings the view buttons back", async () => {
  const { user } = renderList();
  await user.click(screen.getByRole("button", { name: "Select" }));
  await user.click(screen.getByRole("button", { name: "Done" }));
  assert.equal(screen.queryByRole("checkbox"), null);
  assert.ok(within(document.body).getAllByRole("link", { name: /Priority/ }).length > 0);
});
