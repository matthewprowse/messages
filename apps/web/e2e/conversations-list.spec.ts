// The Conversations list on each of the core three screens: every view holds the right conversations, the Filter menu
// narrows them, By Person groups them (and opens a person), search finds by subject and name, and each row carries what the
// AI worker left on it (Urgent, Needs Reply, labels). Read only: nothing here changes a row, so the order does not matter.

import { conversation } from "./support/fake-data";
import { expect, test } from "./support/fixtures";
import { chooseFilter, listOf, openInbox, rowOf, rowsOf, showView } from "./support/ui";

const subject = (key: string) => conversation(key).subject;

test.beforeEach(async ({ login, page }) => {
  await login();
  await openInbox(page);
});

test("each view holds the conversations that belong in it", async ({ page }) => {
  await showView(page, "Priority");
  for (const key of ["kitchen", "lease", "wedding"]) await expect(rowOf(page, subject(key))).toBeVisible();
  // Answered, normal or merely informative: not priority.
  for (const key of ["tax", "website", "invoice"]) await expect(rowsOf(page, subject(key))).toHaveCount(0);

  await showView(page, "Junk");
  await expect(rowOf(page, subject("prize"))).toBeVisible();
  await expect(rowsOf(page, subject("kitchen"))).toHaveCount(0);

  // Subscriptions list the sender, who can be unsubscribed from, with Clean Up beside them.
  await showView(page, "Subscriptions");
  await expect(rowOf(page, /news@example\.net/)).toBeVisible();
  await expect(listOf(page).getByRole("link", { name: "Clean Up" })).toBeVisible();

  await showView(page, "Archive");
  await expect(rowOf(page, subject("archived"))).toBeVisible();

  await showView(page, "Snoozed");
  await expect(rowOf(page, subject("snoozed"))).toBeVisible();
  await expect(page.getByText(/^Snoozed/).first()).toBeVisible();

  await showView(page, "Deleted");
  await expect(page.getByText("Nothing Deleted").first()).toBeVisible();

  await showView(page, "All");
  await expect(rowOf(page, subject("kitchen"))).toBeVisible();
  await expect(rowsOf(page, subject("snoozed"))).toHaveCount(0);
});

test("the Filter menu narrows by unread, channel and waiting", async ({ page }) => {
  await chooseFilter(page, "Unread");
  await expect(page.getByRole("button", { name: "Filter, Unread" })).toBeVisible();
  await expect(rowOf(page, subject("kitchen"))).toBeVisible();
  await expect(rowOf(page, /Grace Dlamini/)).toBeVisible();
  await expect(rowsOf(page, subject("website"))).toHaveCount(0);

  await chooseFilter(page, "WhatsApp");
  await expect(rowOf(page, /Grace Dlamini/)).toBeVisible();
  await expect(rowOf(page, /Weekend Hike Crew/)).toBeVisible();
  await expect(rowsOf(page, subject("kitchen"))).toHaveCount(0);

  await chooseFilter(page, "Email");
  await expect(rowOf(page, subject("kitchen"))).toBeVisible();
  await expect(rowsOf(page, /Grace Dlamini/)).toHaveCount(0);

  // Waiting: you wrote last, expected an answer, and two days have passed.
  await chooseFilter(page, "Waiting");
  await expect(rowOf(page, subject("invoice"))).toBeVisible();
  await expect(rowsOf(page, subject("kitchen"))).toHaveCount(0);

  await chooseFilter(page, "No Filter");
  await expect(rowOf(page, subject("kitchen"))).toBeVisible();
  await expect(page.getByRole("button", { name: "Filter", exact: true })).toBeVisible();
});

test("By Person shows one row for a person with several conversations, and opens their page", async ({ page }) => {
  await chooseFilter(page, "By Person");
  await expect(page.getByRole("button", { name: "Filter, By Person" })).toBeVisible();
  // Ava Thompson wrote three of the conversations; she is one row. Chats are rows of their own.
  await expect(rowsOf(page, /Ava Thompson/)).toHaveCount(1);
  await expect(rowsOf(page, /Grace Dlamini/)).toHaveCount(1);
  await expect(rowsOf(page, /Weekend Hike Crew/)).toHaveCount(1);

  await rowsOf(page, /Ava Thompson/).click();
  await expect(page).toHaveURL(/\/inbox\/person\/[0-9a-f-]{36}/);
  await expect(page.getByText("3 Conversations")).toBeVisible();
  for (const key of ["kitchen", "offsite", "bulk2"]) {
    for (const m of conversation(key).messages.filter((x) => x.from === 0)) await expect(page.getByText(m.body)).toBeVisible();
  }
});

test("search finds conversations by subject and by name, and says when nothing matches", async ({ page }) => {
  const search = page.getByRole("searchbox", { name: "Search Conversations" });
  await search.fill("Kitchen");
  await expect(rowOf(page, subject("kitchen"))).toBeVisible();
  await expect(rowsOf(page, subject("lease"))).toHaveCount(0);

  await search.fill("Ben Carter");
  await expect(rowOf(page, subject("lease"))).toBeVisible();
  await expect(rowOf(page, subject("insurance"))).toBeVisible();
  await expect(rowsOf(page, subject("kitchen"))).toHaveCount(0);

  await search.fill("Hike");
  await expect(rowOf(page, /Weekend Hike Crew/)).toBeVisible();

  await search.fill("zzzz no such thing");
  await expect(page.getByText("No Matches").first()).toBeVisible();
  await search.fill("");
  await expect(rowOf(page, subject("kitchen"))).toBeVisible();
});

test("rows carry the AI's tags: Urgent, Needs Reply, and the labels a conversation wears", async ({ page }) => {
  const kitchen = rowsOf(page, subject("kitchen"));
  const lease = rowsOf(page, subject("lease"));
  // Urgent beats Needs Reply; a Needs Reply conversation has just that; the rest have neither.
  await expect(kitchen.getByText("Urgent", { exact: true })).toBeVisible();
  await expect(kitchen.getByText("Needs Reply")).toHaveCount(0);
  await expect(lease.getByText("Needs Reply", { exact: true })).toBeVisible();
  await expect(lease.getByText("Urgent", { exact: true })).toHaveCount(0);
  const website = rowsOf(page, subject("website"));
  await expect(website.getByText(/^(Urgent|Needs Reply)$/)).toHaveCount(0);
  await expect(kitchen.getByText("Clients", { exact: true })).toBeVisible();

  // The label chip narrows the list to the conversations wearing it.
  await page.getByRole("group", { name: "Labels" }).getByRole("link", { name: "Clients" }).click();
  await expect(rowOf(page, subject("kitchen"))).toBeVisible();
  await expect(rowOf(page, subject("wedding"))).toBeVisible();
  await expect(rowsOf(page, subject("lease"))).toHaveCount(0);
});

test("WhatsApp chats and groups are listed by name with their latest message", async ({ page }) => {
  await expect(rowOf(page, /Grace Dlamini.*Perfect, see you then/)).toBeVisible();
  // A group says who spoke last.
  await expect(rowOf(page, /Weekend Hike Crew.*Seven is fine/)).toBeVisible();
  await expect(rowOf(page, /Jonas Smit/)).toBeVisible();
});
