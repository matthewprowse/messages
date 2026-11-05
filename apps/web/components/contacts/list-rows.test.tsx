// The Contacts list rows (contacts/list-rows.tsx) inside the list (contact-list.tsx): names in order with the starred
// first, the star and unread marks, a row opening the contact, search, and the empty states.

import { mock, test } from "node:test";
import assert from "node:assert/strict";
import { screen, waitFor, within } from "@testing-library/react";
import { ContactList } from "@/components/contact-list";
import { ContactsDataContext, type ContactsData } from "@/components/contacts-data";
import { ListRow } from "./list-rows";
import { argsOf } from "@/test/fake-store";
import { renderScreen, type ScreenOptions } from "@/test/render";
import { AVA, BEN, thread } from "@/test/fixtures";
import { SUMMARIES, summary } from "@/test/contacts-fixtures";
import type { ContactSummary } from "@/lib/contacts";

/** The list with the Contacts layout's shared data, its needCompanies and reload as spies. */
function renderList(contacts: ContactSummary[] | null | "loading" = SUMMARIES, options: ScreenOptions = {}) {
  const list = contacts === "loading" ? undefined : contacts;
  const data = { contacts: list, suggestions: [], suggestionsMore: 0, removeSuggestion: () => undefined, restoreSuggestion: () => undefined, needCompanies: mock.fn(), reload: mock.fn(), patchContact: () => undefined } as unknown as ContactsData;
  const s = renderScreen(<ContactsDataContext.Provider value={data}><ContactList contacts={list} companies={[]} /></ContactsDataContext.Provider>, { path: "/contacts", ...options });
  return { ...s, data: data as ContactsData & { needCompanies: ReturnType<typeof mock.fn>; reload: ReturnType<typeof mock.fn> } };
}

/** The names on the rows, top to bottom. */
const rowNames = () => screen.getAllByRole("link").map((a) => a.querySelector(".font-medium")?.textContent);

test("a row shows the name, links to the contact, and marks the open one", () => {
  renderScreen(<ListRow href="/contacts/contact-ava" title="Ava Thompson" detail="Thompson Interiors" unread={2} selected />);
  const row = screen.getByRole("link", { name: /Ava Thompson/ });
  assert.equal(row.getAttribute("href"), "/contacts/contact-ava");
  assert.equal(row.getAttribute("aria-current"), "page");
  assert.ok(within(row).getByText("Thompson Interiors"));
  assert.ok(within(row).getByLabelText("2 unread"));
});

test("a row with no unread messages shows no count", () => {
  renderScreen(<ListRow href="/contacts/contact-ben" title="Ben Carter" detail="" />);
  assert.equal(screen.queryByLabelText(/unread/), null);
  assert.equal(screen.getByRole("link").getAttribute("aria-current"), null);
});

test("the starred person comes first, marked Starred, then the rest by most recent", () => {
  renderList();
  assert.deepEqual(rowNames(), ["Ava Thompson", "Ben Carter", "Chloe Naidoo", "Daniel Mokoena"]);
  const ava = screen.getByRole("link", { name: /Ava Thompson/ });
  assert.ok(within(ava).getByLabelText("Starred"));
  assert.equal(within(screen.getByRole("link", { name: /Ben Carter/ })).queryByLabelText("Starred"), null);
});

test("each row opens that contact's page", () => {
  renderList();
  assert.equal(screen.getByRole("link", { name: /Chloe Naidoo/ }).getAttribute("href"), "/contacts/contact-chloe");
});

test("a person's unread count matches their unread Inbox conversations", () => {
  renderList(SUMMARIES, { threads: [thread("t-unread", { participantIds: [BEN.id], unread: true, unreadCount: 3 })] });
  assert.ok(within(screen.getByRole("link", { name: /Ben Carter/ })).getByLabelText("3 unread"));
});

test("searching narrows the list by name or address, and a miss says No Matches", async () => {
  const { user } = renderList();
  const search = screen.getByPlaceholderText("Search Contacts");
  await user.type(search, "naidoo");
  await waitFor(() => assert.deepEqual(rowNames(), ["Chloe Naidoo"]));
  await user.clear(search);
  await user.type(search, "example.org");
  await waitFor(() => assert.deepEqual(rowNames(), ["Ben Carter"]));
  await user.clear(search);
  await user.type(search, "nobody at all");
  assert.ok(await screen.findByText("No Matches"));
});

test("Escape in search clears it and the whole list comes back", async () => {
  const { user } = renderList();
  const search = screen.getByPlaceholderText("Search Contacts");
  await user.type(search, "carter");
  await waitFor(() => assert.equal(rowNames().length, 1));
  await user.keyboard("{Escape}");
  await waitFor(() => assert.equal(rowNames().length, 4));
});

test("loading shows placeholder rows, and a failed load offers Retry", async () => {
  const { unmount } = renderList("loading");
  assert.equal(screen.getByLabelText("Loading contacts").getAttribute("aria-busy"), "true");
  unmount();
  const { user, data } = renderList(null);
  assert.ok(screen.getByText("Contacts Did Not Load"));
  await user.click(screen.getByRole("button", { name: "Retry" }));
  assert.equal(data.reload.mock.callCount(), 1);
});

test("with nobody yet the list says No Contacts Yet", () => {
  renderList([]);
  assert.ok(screen.getByText("No Contacts Yet"));
});

test("hidden people are left out, and when everyone is hidden the list says where they went", async () => {
  const { user, router } = renderList([summary(AVA, { hidden: true })]);
  assert.equal(screen.queryByRole("link", { name: /Ava Thompson/ }), null);
  assert.ok(screen.getByText("Everyone Is Under Companies or Hidden"));
  // Hidden appears as a view once someone is hidden.
  assert.ok(screen.getByRole("button", { name: "Hidden" }));
  await user.click(screen.getByRole("button", { name: "Open Companies" }));
  assert.deepEqual(argsOf(router.replace)[0], ["/contacts?view=companies"]);
});

test("choosing a view replaces the address rather than adding to history", async () => {
  const { user, router } = renderList();
  await user.click(screen.getByRole("button", { name: "Companies" }));
  assert.deepEqual(argsOf(router.replace)[0], ["/contacts?view=companies"]);
  assert.equal(router.push.mock.callCount(), 0);
});

test("New Contact opens the New Contact dialog", async () => {
  const { user } = renderList();
  await user.click(screen.getByRole("button", { name: "New Contact" }));
  assert.ok(await screen.findByRole("dialog", { name: "New Contact" }));
});
