// The phone layout (below 768px) against the computer one: on iPhone and Android the list and an open conversation are
// separate screens, Back and the browser's back both return to the list, and the bottom bar takes the rail's place, stepping
// aside inside a conversation. On Desktop the same pages sit side by side. Read only.

import { conversation } from "./support/fake-data";
import { expect, test } from "./support/fixtures";
import { bubble, listOf, openInbox, openRow, openSummary, rowOf } from "./support/ui";

const isPhone = (name: string) => name !== "Desktop";
const kitchen = conversation("kitchen");

test.beforeEach(async ({ login }) => {
  await login();
});

test("on a phone the list and the open conversation are separate screens, and Back returns to the list", async ({ page }, testInfo) => {
  test.skip(!isPhone(testInfo.project.name), "A computer shows both at once.");
  await openInbox(page);
  await expect(page.getByPlaceholder("Message")).toHaveCount(0);

  await openRow(page, kitchen.subject);
  await expect(bubble(page, kitchen.messages[0].body)).toBeVisible();
  // The list steps aside for the conversation.
  await expect(listOf(page)).toBeHidden();
  await page.getByRole("button", { name: "Back" }).or(page.getByRole("link", { name: "Back" })).click();
  await expect(page).toHaveURL(/\/inbox(\?|$)/);
  await expect(rowOf(page, kitchen.subject)).toBeVisible();
  await expect(page.getByPlaceholder("Message")).toHaveCount(0);
});

test("on a phone the browser's own back returns to the list, and forward reopens the conversation", async ({ page }, testInfo) => {
  test.skip(!isPhone(testInfo.project.name), "A computer shows both at once.");
  await openInbox(page);
  const id = await openRow(page, kitchen.subject);
  await page.goBack();
  await expect(page).toHaveURL(/\/inbox(\?|$)/);
  await expect(rowOf(page, kitchen.subject)).toBeVisible();
  await page.goForward();
  await expect(page).toHaveURL(new RegExp(`/inbox/${id}`));
  await expect(bubble(page, kitchen.messages[0].body)).toBeVisible();
});

test("on a computer the list stays beside the open conversation", async ({ page }, testInfo) => {
  test.skip(isPhone(testInfo.project.name), "A phone shows one at a time.");
  await openInbox(page);
  await openRow(page, kitchen.subject);
  await expect(bubble(page, kitchen.messages[0].body)).toBeVisible();
  await expect(rowOf(page, kitchen.subject)).toBeVisible();
  await expect(page.getByRole("button", { name: "Back" })).toBeHidden();
  // The rail is the computer's navigation; there is no bottom bar.
  await expect(page.getByRole("navigation", { name: "Main" })).toHaveCount(1);
});

test("the bottom bar takes people between places, and steps aside inside a conversation", async ({ page }, testInfo) => {
  test.skip(!isPhone(testInfo.project.name), "A computer has the rail.");
  await openInbox(page);
  const bar = page.getByRole("navigation", { name: "Main" });
  await expect(bar).toBeVisible();
  for (const name of ["Search", "Summary", "Calendar", "Conversations", "Contacts", "More"]) await expect(bar.getByRole(name === "Search" ? "button" : "link", { name, exact: true })).toBeVisible();
  await expect(bar.getByRole("link", { name: "Conversations", exact: true })).toHaveAttribute("aria-current", "page");

  await bar.getByRole("link", { name: "Summary", exact: true }).click();
  await expect(page).toHaveURL(/\/summary$/);
  await expect(page.getByRole("heading", { name: "Summary", level: 1 })).toBeVisible();
  await expect(bar.getByRole("link", { name: "Summary", exact: true })).toHaveAttribute("aria-current", "page");

  await bar.getByRole("link", { name: "More", exact: true }).click();
  await expect(page).toHaveURL(/\/more$/);
  await expect(page.getByRole("button", { name: "New Email" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Notes" })).toBeVisible();

  await bar.getByRole("link", { name: "Conversations", exact: true }).click();
  await expect(page).toHaveURL(/\/inbox$/);
  await openRow(page, kitchen.subject);
  await expect(page.getByRole("navigation", { name: "Main" })).toHaveCount(0);
});

test("the bottom bar's Search opens the search palette over the page", async ({ page }, testInfo) => {
  test.skip(!isPhone(testInfo.project.name), "A computer has the rail.");
  await openInbox(page);
  await page.getByRole("navigation", { name: "Main" }).getByRole("button", { name: "Search" }).click();
  const palette = page.getByRole("dialog", { name: "Search" });
  await expect(palette).toBeVisible();
  await palette.getByPlaceholder("Search Everything").fill("Kitchen");
  await expect(palette.getByText(kitchen.subject).first()).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(palette).toHaveCount(0);
});

test("the Summary's list and an open conversation are separate screens on a phone", async ({ page }, testInfo) => {
  test.skip(!isPhone(testInfo.project.name), "A computer shows both at once.");
  await openSummary(page);
  const row = page.getByRole("region", { name: "Needs Reply" }).getByRole("link", { name: kitchen.subject });
  await row.click();
  await expect(page).toHaveURL(/\/summary\/[0-9a-f-]{36}/);
  await expect(bubble(page, kitchen.messages[0].body)).toBeVisible();
  await expect(page.getByRole("heading", { name: "Summary", level: 1 })).toBeHidden();
  await page.getByRole("button", { name: "Back" }).or(page.getByRole("link", { name: "Back" })).click();
  await expect(page).toHaveURL(/\/summary$/);
  await expect(page.getByRole("heading", { name: "Summary", level: 1 })).toBeVisible();
});
