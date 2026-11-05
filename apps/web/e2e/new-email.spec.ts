// New Email on each of the core three screens: the dialog takes the addresses, subject and text, and Send queues one outbox
// row for the worker (the Undo window holds it), then stops: Undo takes the row back, so nothing is left to be sent. No worker
// runs and the account has no sign-in, so nothing could leave in any case.

import { outboxExists, waitForOutbox } from "./support/fake-worker";
import { expect, test } from "./support/fixtures";
import { openInbox } from "./support/ui";

test("New Email queues an outbox row with the text, and Undo takes it back", async ({ page, login, me }, testInfo) => {
  await login();
  // A computer has the rail's New menu; a phone has the same things on its More screen.
  if (testInfo.project.name === "Desktop") {
    await openInbox(page);
    await page.getByRole("button", { name: "New", exact: true }).click();
    await page.getByRole("menuitem", { name: "New Email" }).click();
  } else {
    await page.goto("/more");
    await page.getByRole("button", { name: "New Email" }).click();
  }
  const dialog = page.getByRole("dialog", { name: "New Email" });
  await expect(dialog).toBeVisible();

  const body = "Hello, I would like to book a site visit for next week.";
  await dialog.getByRole("textbox", { name: "To", exact: true }).fill("new.client@example.com");
  await dialog.getByRole("textbox", { name: "Subject", exact: true }).fill("Site Visit Request");
  await dialog.getByRole("textbox", { name: "Message", exact: true }).fill(body);
  await dialog.getByRole("button", { name: "Send", exact: true }).click();

  const queued = await waitForOutbox(me.project, body);
  expect(queued.status).toBe("queued");
  expect(queued.threadId).toBeNull();
  expect(Date.parse(queued.sendAfter!)).toBeGreaterThan(Date.parse(queued.createdAt));
  await expect(dialog.getByRole("button", { name: /^Sending in \d+s$/ })).toBeVisible();

  await dialog.getByRole("button", { name: "Undo", exact: true }).click();
  await expect.poll(() => outboxExists(me.project, queued.id)).toBe(false);
});
