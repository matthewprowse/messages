// Mail that arrives while the app is open, on each of the core three screens: a message in the open conversation, a new
// conversation in the list, a WhatsApp message, and a message that came while the device was offline, which the app catches
// up on once it is back. The fake worker stores each exactly as the sync worker would; Realtime does the telling.

import { conversation } from "./support/fake-data";
import { arriveEmail, arriveNewEmail, arriveWhatsApp } from "./support/fake-incoming";
import { expect, test } from "./support/fixtures";
import { bubble, openInbox, openRow, rowOf } from "./support/ui";

test.beforeEach(async ({ login }) => {
  await login();
});

test("a message arriving in the open conversation appears without a reload", async ({ page, me }) => {
  await openInbox(page);
  await openRow(page, conversation("live").subject);
  const text = "I have attached the photographs of the two loose tiles.";
  await expect(bubble(page, text)).toHaveCount(0);
  await arriveEmail(me.project, "live", text);
  await expect(bubble(page, text)).toBeVisible();
});

test("a new conversation arriving shows at the top of the list, unread, without a reload", async ({ page, me }) => {
  await openInbox(page);
  const subject = "Courier Delivery Window";
  await expect(rowOf(page, subject)).toHaveCount(0);
  await arriveNewEmail(me.project, subject, "The courier will arrive between ten and noon tomorrow.", 5);
  const row = rowOf(page, subject);
  await expect(row).toBeVisible();
  await expect(row.getByLabel("1 unread")).toBeVisible();
});

test("a WhatsApp message arriving updates the chat's row", async ({ page, me }) => {
  await openInbox(page);
  const text = "The delivery came in an hour ago, thank you.";
  await expect(rowOf(page, /Jonas Smit/)).toContainText("Did the delivery arrive");
  await arriveWhatsApp(me.project, "jonas", text);
  await expect(rowOf(page, /Jonas Smit/)).toContainText(text);
  await expect(rowOf(page, /Jonas Smit/).getByLabel("1 unread")).toBeVisible();
});

test("a message that came while offline appears once the connection is back", async ({ page, me, network }) => {
  // The catch-up only reaches for what a drop of half a minute or more missed (lib/app-store/resync-plan.ts), so the page's
  // clock is the one this test moves, instead of the test waiting that long.
  await page.clock.install();
  await openInbox(page);
  await openRow(page, conversation("offline").subject);
  await expect(bubble(page, "Here is the quote for the solar panels")).toBeVisible();

  await network.offline();
  const text = "Sorry for the delay, the installer can start on Monday.";
  await arriveEmail(me.project, "offline", text);
  await page.clock.fastForward(60_000);
  await expect(bubble(page, text)).toHaveCount(0);

  await network.online();
  await expect(bubble(page, text)).toBeVisible({ timeout: 30_000 });
});
