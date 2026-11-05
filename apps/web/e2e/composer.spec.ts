// The reply box on each of the core three screens: Send queues an outbox row with the text and the fake worker settles it
// (sent, or failed with Retry), Undo Send takes a queued row back, Send Later queues it for a chosen time, an AI draft
// fills the box when it is ready (waiting, or asked for and then written by the fake worker), and the reply choices offer
// Accept and Decline and Add to Calendar. Every send stops at the queue: no worker runs and the account has no sign-in.

import { conversation } from "./support/fake-data";
import { storeSentCopy } from "./support/fake-incoming";
import { fillDraft, markOutboxFailed, markOutboxSent, outboxExists, outboxFor, waitForDraftRequest, waitForOutbox } from "./support/fake-worker";
import { expect, test } from "./support/fixtures";
import { bubble, openInbox, openRow, replyBox, sendReply } from "./support/ui";

const subject = (key: string) => conversation(key).subject;

test.beforeEach(async ({ login, page }) => {
  await login();
  await openInbox(page);
});

test("Send queues the reply, the fake worker sends it, and the bubble reads Sent until its copy arrives", async ({ page, me }) => {
  const text = "Thank you, Wednesdays are fine for the garden service.";
  const threadId = await openRow(page, subject("garden"));
  await sendReply(page, text);
  await expect(replyBox(page)).toHaveValue("");
  await expect(bubble(page, text).getByText("Waiting to Send")).toBeVisible();

  const queued = await waitForOutbox(me.project, text, { threadId });
  expect(queued.status).toBe("queued");
  // The Undo Send window: the worker may not send before it ends.
  expect(Date.parse(queued.sendAfter!)).toBeGreaterThan(Date.parse(queued.createdAt));

  await markOutboxSent(me.project, queued.id);
  await expect(bubble(page, text).getByText("Sent", { exact: true })).toBeVisible();

  // The next sync stores the copy from the Sent folder, and the placeholder gives way to the real message.
  await storeSentCopy(me.project, queued.id);
  await expect(bubble(page, text)).toHaveCount(1);
  await expect(bubble(page, text).getByText("Sent", { exact: true })).toHaveCount(0);
});

test("a failed send says so and Retry queues the same text again", async ({ page, me }) => {
  const text = "Please send the assessor's report when you have it.";
  const threadId = await openRow(page, subject("insurance"));
  await sendReply(page, text);
  const first = await waitForOutbox(me.project, text, { threadId, status: "queued" });

  await markOutboxFailed(me.project, first.id, "Nothing was sent. Try again.");
  // The bubble gives the worker's reason, and Retry only because the send certainly did not go out.
  await expect(bubble(page, text).getByText("Nothing was sent. Try again.")).toBeVisible();
  await bubble(page, text).getByRole("button", { name: "Retry" }).click();

  // A new row, with the same text; the failed one leaves the conversation.
  const again = await waitForOutbox(me.project, text, { threadId, status: "queued" });
  expect(again.id).not.toBe(first.id);
  await expect(bubble(page, text).getByRole("button", { name: "Retry" })).toHaveCount(0);
  await expect(bubble(page, text).getByText("Waiting to Send")).toBeVisible();
});

test("Undo inside the window takes the queued row back and returns the text to the box", async ({ page, me }) => {
  const text = "Actually, hold on, let me check the plan first.";
  const threadId = await openRow(page, subject("consultation"));
  await sendReply(page, text);
  const queued = await waitForOutbox(me.project, text, { threadId });

  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect.poll(() => outboxExists(me.project, queued.id)).toBe(false);
  await expect(replyBox(page)).toHaveValue(text);
  await expect(bubble(page, text)).toHaveCount(0);
});

test("Send Later queues the reply for the morning and shows when it goes", async ({ page, me }) => {
  const text = "I will send the venue deposit tomorrow.";
  const threadId = await openRow(page, subject("offsite"));
  await replyBox(page).fill(text);
  await page.getByRole("button", { name: "Send Later" }).click();
  await page.getByRole("menuitem", { name: /Tomorrow Morning/ }).click();

  const queued = await waitForOutbox(me.project, text, { threadId });
  const due = new Date(queued.sendAfter!);
  // 08:00 tomorrow in the zone the browser runs in: between 07:00 and 09:00 SAST is 05:00 to 07:00 UTC.
  expect(due.getUTCHours()).toBe(6);
  expect(due.getTime() - Date.parse(queued.createdAt)).toBeGreaterThan(60_000);
  await expect(bubble(page, text).getByText(/Tomorrow 08:00/)).toBeVisible();
  await expect(bubble(page, text).getByRole("button", { name: "Cancel" })).toBeVisible();
});

test("a WhatsApp reply queues for the chat and the fake worker sends it", async ({ page, me }) => {
  const text = "Seven works. I will pick up the water.";
  const threadId = await openRow(page, /Weekend Hike Crew/);
  await sendReply(page, text);
  const queued = await waitForOutbox(me.project, text, { threadId });
  expect(queued.status).toBe("queued");
  await markOutboxSent(me.project, queued.id);
  await expect(bubble(page, text).getByText("Sent", { exact: true })).toBeVisible();
  expect((await outboxFor(me.project, threadId)).map((r) => r.status)).toContain("sent");
});

test("a draft waiting for you fills the reply box, marked as the AI's", async ({ page }) => {
  await openRow(page, subject("lease"));
  await expect(replyBox(page)).toHaveValue(/let us renew on the same terms/);
  await expect(page.getByText("AI Draft", { exact: true })).toBeVisible();
});

test("asking for a draft queues a request and the written draft appears live", async ({ page, me }) => {
  const written = "Thank you, Emma. I have made the contact button larger and moved it above the fold.";
  const threadId = await openRow(page, subject("website"));
  await expect(replyBox(page)).toHaveValue("");
  await page.getByRole("button", { name: "Draft", exact: true }).click();

  const request = await waitForDraftRequest(me.project, threadId);
  expect(request.tone).toBe("default");
  await fillDraft(me.project, request.id, written);
  await expect(replyBox(page)).toHaveValue(written);
  await expect(page.getByText("AI Draft", { exact: true })).toBeVisible();
});

test("reply choices offer Accept and Decline, and picking one asks for a draft that says it", async ({ page, me }) => {
  const threadId = await openRow(page, subject("shoot"));
  await expect(page.getByRole("button", { name: "Accept", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Decline", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Accept", exact: true }).click();

  const request = await waitForDraftRequest(me.project, threadId);
  const decision = "I would be glad to do the portrait shoot on Saturday.";
  await fillDraft(me.project, request.id, `Hi Daniel, ${decision}`);
  await expect(replyBox(page)).toHaveValue(new RegExp(decision));
});

test("Add to Calendar opens New Event filled in from the message, and nothing is created", async ({ page }) => {
  await openRow(page, subject("wedding"));
  await page.getByRole("button", { name: "Add to Calendar" }).click();
  const dialog = page.getByRole("dialog", { name: "New Event" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByLabel("Title")).toHaveValue("Wedding Photography");
  await expect(dialog.getByLabel("Location")).toHaveValue("Stellenbosch Estate");
  await expect(dialog.getByRole("switch", { name: "All Day" })).toBeChecked();
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect(dialog).toHaveCount(0);
});
