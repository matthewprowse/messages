// What a person does to conversations, on each of the core three screens. Each action shows at once and queues the row a
// worker would act on (mail_actions for the mail server, a thread column for the app's own state, unsubscribes for the
// sender); the fake worker marks the mail actions done. Nothing is sent. Each test has a conversation of its own.

import { conversation } from "./support/fake-data";
import { completeMailActions, waitForMailAction, waitForMailActions } from "./support/fake-worker";
import { expect, test } from "./support/fixtures";
import { labelNamesOf, threadState, unsubscribeStatuses } from "./support/reads";
import { listOf, openInbox, openRow, rowOf, rowsOf, selectRows, showView } from "./support/ui";

const subject = (key: string) => conversation(key).subject;

test.beforeEach(async ({ login, page }) => {
  await login();
  await openInbox(page);
});

/** Opens the conversation's More menu (the header's), where Archive, Delete, Snooze and Label live. */
const openMore = async (page: import("@playwright/test").Page) => {
  await page.getByRole("button", { name: "More", exact: true }).click();
};

/** Closes the menu and any submenu in it, and waits until none is left, so the next step does not meet one half shut. */
const closeMenus = async (page: import("@playwright/test").Page) => {
  await expect(async () => {
    await page.keyboard.press("Escape");
    await expect(page.getByRole("menu")).toHaveCount(0, { timeout: 500 });
  }).toPass();
};

test("a label from the More menu is saved on the conversation and shows on its row", async ({ page, me }, testInfo) => {
  const threadId = await openRow(page, subject("labelled"));
  await openMore(page);
  await page.getByRole("menuitem", { name: "Label" }).click();
  await page.getByRole("menuitemcheckbox", { name: "Personal" }).click();
  await expect.poll(() => labelNamesOf(me.project, threadId)).toEqual(["Personal"]);
  await closeMenus(page);
  // A phone shows the list and the conversation one at a time.
  if (testInfo.project.name !== "Desktop") await page.getByRole("link", { name: "Back" }).click();
  await expect(rowOf(page, subject("labelled")).getByText("Personal", { exact: true })).toBeVisible();
  if (testInfo.project.name !== "Desktop") await rowOf(page, subject("labelled")).click();

  // Ticked again it comes off.
  await openMore(page);
  await page.getByRole("menuitem", { name: "Label" }).click();
  await page.getByRole("menuitemcheckbox", { name: "Personal" }).click();
  await expect.poll(() => labelNamesOf(me.project, threadId)).toEqual([]);
});

test("Snooze hides the conversation at once and lists it under Snoozed", async ({ page }) => {
  await openRow(page, subject("snooze"));
  await openMore(page);
  await page.getByRole("menuitem", { name: "Snooze" }).click();
  await page.getByRole("menuitem", { name: "Tomorrow", exact: true }).click();

  await expect(rowsOf(page, subject("snooze"))).toHaveCount(0);
  await showView(page, "Snoozed");
  await expect(rowOf(page, subject("snooze"))).toBeVisible();
});

// KNOWN BUG, so this is expected to fail: the app's snooze is refused by the database. Migration 20261102100200 revoked
// UPDATE on public.threads from signed-in users except for five columns, and 20261118110000 added snoozed_until, snooze_kind
// and snoozed_at without granting them, so the save answers 403 (42501) and the app shows its "could not save" toast. When
// a migration grants them this test starts passing, which Playwright reports as a failure: delete the test.fail line then.
test("Snooze is saved on the conversation for tomorrow at 08:00", async ({ page, me }) => {
  test.fail();
  const threadId = await openRow(page, subject("snooze"));
  await openMore(page);
  await page.getByRole("menuitem", { name: "Snooze" }).click();
  await page.getByRole("menuitem", { name: "Tomorrow", exact: true }).click();
  await expect.poll(async () => (await threadState(me.project, threadId)).snoozed_until, { timeout: 5_000 }).not.toBeNull();
  const state = await threadState(me.project, threadId);
  expect(state.snooze_kind).toBe("snooze");
  // Tomorrow at 08:00 in the zone the browser runs in is 06:00 UTC.
  expect(new Date(state.snoozed_until!).getUTCHours()).toBe(6);
  expect(Date.parse(state.snoozed_until!)).toBeGreaterThan(Date.now());
});

test("Archive moves the conversation to Archive and queues the archive for the mail server", async ({ page, me }) => {
  const threadId = await openRow(page, subject("archive"));
  await openMore(page);
  await page.getByRole("menuitem", { name: "Archive", exact: true }).click();

  const action = await waitForMailAction(me.project, threadId, "archive");
  expect(action.status).toBe("queued");
  expect((await threadState(me.project, threadId)).status).toBe("archived");
  await expect(rowsOf(page, subject("archive"))).toHaveCount(0);
  await completeMailActions(me.project, [action.id]);

  await showView(page, "Archive");
  await expect(rowOf(page, subject("archive"))).toBeVisible();
});

test("Delete queues the bin move, and Restore brings the conversation back", async ({ page, me }) => {
  const threadId = await openRow(page, subject("trash"));
  await openMore(page);
  await page.getByRole("menuitem", { name: "Delete", exact: true }).click();
  const trash = await waitForMailAction(me.project, threadId, "trash");
  expect(trash.status).toBe("queued");
  expect((await threadState(me.project, threadId)).status).toBe("trash");
  await completeMailActions(me.project, [trash.id]);

  // The bin is not a list of links: each entry has a Restore button.
  await showView(page, "Deleted");
  await expect(listOf(page).getByText(subject("trash"))).toBeVisible();
  await page.getByRole("button", { name: "Restore" }).click();
  const untrash = await waitForMailAction(me.project, threadId, "untrash");
  expect(untrash.status).toBe("queued");
  await expect.poll(async () => (await threadState(me.project, threadId)).status).toBe("inbox");
  await showView(page, "All");
  await expect(rowOf(page, subject("trash"))).toBeVisible();
});

test("selecting conversations and pressing Mark as Read queues a read for each", async ({ page, me }) => {
  const [one, two] = [me.world.threads.bulk1, me.world.threads.bulk2];
  await selectRows(page, [subject("bulk1"), subject("bulk2")]);
  await expect(page.getByText("2 Selected")).toBeVisible();
  await page.getByRole("button", { name: "Mark as Read" }).click();

  const actions = await waitForMailActions(me.project, [one, two], "read");
  expect(actions.map((a) => a.status)).toEqual(["queued", "queued"]);
  for (const id of [one, two]) await expect.poll(async () => (await threadState(me.project, id)).unread_count).toBe(0);
  await completeMailActions(me.project, actions.map((a) => a.id));
  await page.getByRole("button", { name: "Done Selecting" }).click();
  await expect(rowOf(page, subject("bulk1")).getByLabel(/unread/)).toHaveCount(0);
});

test("Clean Up offers the sender nobody opens, and Unsubscribe queues the request", async ({ page, me }) => {
  await showView(page, "Subscriptions");
  await listOf(page).getByRole("link", { name: "Clean Up" }).click();
  await expect(page).toHaveURL(/\/inbox\/clean-up/);
  await expect(page.getByText(/1 email, none opened in \d+ days/)).toBeVisible();

  // The sender is a bulk sender that offers a way out; nothing happens until the button is pressed, and then it is a queued row.
  expect(await unsubscribeStatuses(me.project)).toEqual([]);
  await page.getByRole("button", { name: "Unsubscribe", exact: true }).click();
  await expect.poll(() => unsubscribeStatuses(me.project)).toEqual(["queued"]);
  await expect(page.getByText(/Unsubscribing/)).toBeVisible();
});
