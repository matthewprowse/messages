// Locators and small steps the Conversations and Summary tests share, so a change to the screen is a change in one place.
// Role and label locators only; every wait is on a condition. Nothing here reads or logs message text beyond matching it.

import { expect, type Locator, type Page } from "@playwright/test";

const THREAD_URL = /\/(inbox|summary)\/([0-9a-f-]{36})(?:\?|$)/;

/** The id of the conversation the page is showing, from its address. */
export function openThreadId(page: Page): string {
  const match = THREAD_URL.exec(page.url());
  if (!match) throw new Error("No conversation is open.");
  return match[2];
}

// A page load that is stuck on the shared test database or the network (every request pending, nothing wrong with the app) is
// tried once more with a fresh load, as a person would reload. A page that really is broken fails both tries.
const LOAD_TRIES_MS = 45_000;

/** Opens the Conversations list and waits until it has rows (the data key has opened and the list has loaded). */
export async function openInbox(page: Page, query = ""): Promise<void> {
  await expect(async () => {
    await page.goto(`/inbox${query}`);
    await expect(page.getByRole("heading", { name: "Conversations" })).toBeVisible({ timeout: 5_000 });
    await expect(rowOf(page, /Kitchen Renovation Quote|Weekly Design Digest|Old Project Handover/)).toBeVisible({ timeout: 15_000 });
  }).toPass({ timeout: LOAD_TRIES_MS, intervals: [0] });
}

/** Opens the Summary and waits until its list has loaded (the Needs Reply section is there). Same second try as openInbox. */
export async function openSummary(page: Page): Promise<void> {
  await expect(async () => {
    await page.goto("/summary");
    await expect(page.getByRole("heading", { name: "Summary", level: 1 })).toBeVisible({ timeout: 5_000 });
    await expect(page.getByRole("region", { name: "Needs Reply" })).toBeVisible({ timeout: 15_000 });
  }).toPass({ timeout: LOAD_TRIES_MS, intervals: [0] });
}

/** The Conversations list column. The pane beside it (Inbox home) has links of its own, so rows are always looked for in here. */
export const listOf = (page: Page): Locator => page.locator("aside");

/** Every list row for a conversation, by its subject (email) or its name (a chat): for counting, and for checking one is not there. */
export const rowsOf = (page: Page, name: string | RegExp): Locator => listOf(page).getByRole("link", { name });

/** The list row for a conversation, by its subject (email) or its name (a chat). */
export const rowOf = (page: Page, name: string | RegExp): Locator => rowsOf(page, name).first();

/** Clicks a list row and waits for the conversation to open. Returns its id. */
export async function openRow(page: Page, name: string | RegExp): Promise<string> {
  await rowOf(page, name).click();
  await expect(page).toHaveURL(/\/inbox\/[0-9a-f-]{36}/);
  return openThreadId(page);
}

/** A message bubble holding this text, in the open conversation. */
export const bubble = (page: Page, text: string | RegExp): Locator => page.locator("[data-message-id]").filter({ hasText: text });

/** One of the Inbox's views (All, Priority, Junk, Subscriptions, Archive, Snoozed, Deleted). */
export async function showView(page: Page, view: string): Promise<void> {
  await page.getByRole("navigation", { name: "View" }).getByRole("link", { name: new RegExp(`^${view}`) }).click();
  await expect(page.getByRole("navigation", { name: "View" }).getByRole("link", { name: new RegExp(`^${view}`) })).toHaveAttribute("aria-current", "page");
}

/** Chooses an entry of the title row's Filter menu (No Filter, Unread, Email, WhatsApp, Waiting) or ticks By Person. */
export async function chooseFilter(page: Page, entry: string): Promise<void> {
  await page.getByRole("button", { name: /^Filter/ }).click();
  await page.getByRole(entry === "By Person" ? "menuitemcheckbox" : "menuitemradio", { name: entry }).click();
  // The menu closes with an animation; the next step must not meet it half shut.
  await expect(page.getByRole("menu")).toHaveCount(0);
}

/** The reply box of the open conversation. */
export const replyBox = (page: Page): Locator => page.getByPlaceholder("Message");

/** Types a reply and presses Send (not Send Later). */
export async function sendReply(page: Page, text: string): Promise<void> {
  await replyBox(page).fill(text);
  await page.getByRole("button", { name: "Send", exact: true }).click();
}

/** Checks the rows in the list: turns on select mode and ticks each named conversation. */
export async function selectRows(page: Page, names: (string | RegExp)[]): Promise<void> {
  await page.getByRole("button", { name: "Select", exact: true }).click();
  for (const name of names) await rowOf(page, name).click();
}
