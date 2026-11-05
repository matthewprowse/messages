// The inbox on each of the core three screens: it lists the seeded conversations (decrypted in the browser with the test
// user's key), and opening one shows its messages and queues its read receipt as a mail_actions row, which the fake worker
// then marks done. Nothing reaches a mail server: there is none, and no worker runs.

import { CONVERSATIONS, conversation, isUnread } from "./support/fake-data";
import { completeMailActions, unreadCount, waitForMailAction } from "./support/fake-worker";
import { expect, test } from "./support/fixtures";
import { bubble, openInbox, openRow, rowOf, rowsOf } from "./support/ui";

// What the All view holds: junk, subscriptions, archived and snoozed conversations are in their own views. The ones other
// tests archive, delete or snooze (actions.spec.ts) are left out, as they may be gone by the time this runs.
const MOVED_BY_OTHER_TESTS = ["snooze", "archive", "trash"];
const inAll = CONVERSATIONS.filter((c) => !c.ai?.junk && !c.archived && !c.snoozedDays && !MOVED_BY_OTHER_TESTS.includes(c.key));

test.beforeEach(async ({ login }) => {
  await login();
});

test("the inbox lists the seeded conversations", async ({ page }) => {
  await openInbox(page);
  for (const c of inAll) await expect(rowOf(page, c.subject)).toBeVisible();
  // The ones that belong to another view are not in All.
  for (const c of CONVERSATIONS.filter((x) => !inAll.includes(x) && !MOVED_BY_OTHER_TESTS.includes(x.key))) await expect(rowsOf(page, c.subject)).toHaveCount(0);
});

test("opening a conversation shows its messages and queues its read receipt", async ({ page, me }) => {
  const c = conversation("kitchen");
  expect(isUnread(c)).toBe(true);
  await openInbox(page);
  const threadId = await openRow(page, c.subject);
  expect(threadId).toBe(me.world.threads.kitchen);
  for (const m of c.messages) await expect(bubble(page, m.body)).toBeVisible();

  // An email is marked read after two seconds open, and that is queued for the worker to tell the mail server.
  const action = await waitForMailAction(me.project, threadId, "read");
  expect(action.status).toBe("queued");
  await expect.poll(() => unreadCount(me.project, threadId)).toBe(0);
  const done = await completeMailActions(me.project, [action.id]);
  expect(done.map((a) => a.status)).toEqual(["done"]);
});
