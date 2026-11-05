// The Summary on each of the core three screens: its sections (calendar, tasks, promises, what needs a reply, updates), the
// Filter and search, Your Day (the pane beside the list on a computer: the numbers, today's brief as text and the week), the
// brief player with the audio mocked, and the promises Done and Snooze. The tests that change promises or the brief come last
// in this file, after the ones that read them: a file's tests run in order in one worker, and no other file touches these rows.

import { conversation } from "./support/fake-data";
import { BRIEF_SCRIPT, EVENTS, PROMISES, TASKS } from "./support/fake-extras";
import { admin } from "./support/admin";
import { speakBrief } from "./support/fake-worker";
import { expect, test } from "./support/fixtures";
import { briefStatus } from "./support/reads";
import { dayIn } from "./support/time";
import { openSummary } from "./support/ui";

const subject = (key: string) => conversation(key).subject;
const isPhone = (name: string) => name !== "Desktop";

test.beforeEach(async ({ login, page }) => {
  await login();
  await openSummary(page);
});

const region = (page: import("@playwright/test").Page, name: string) => page.getByRole("region", { name });

test("the list gathers today: the calendar, tasks, promises, what needs a reply, and updates", async ({ page }) => {
  await expect(region(page, "Today's Calendar").getByText(EVENTS[0].title)).toBeVisible();
  // Tasks due today and the overdue one.
  await expect(region(page, "Tasks").getByText(TASKS[0].title)).toBeVisible();
  await expect(region(page, "Tasks").getByText(TASKS[1].title)).toBeVisible();
  await expect(region(page, "Tasks").getByText(TASKS[2].title)).toHaveCount(0);

  // Promises: yours due soon and theirs gone past. The far one is not on the page.
  const promises = region(page, "Promises");
  for (const p of PROMISES.slice(0, 3)) await expect(promises.getByText(p.text)).toBeVisible();
  await expect(promises.getByText(PROMISES[3].text)).toHaveCount(0);

  // What waits on you, with the AI's one line under each.
  const reply = region(page, "Needs Reply");
  for (const key of ["kitchen", "lease", "wedding", "shoot"]) await expect(reply.getByRole("link", { name: subject(key) })).toBeVisible();
  await expect(reply.getByRole("link", { name: subject("kitchen") })).toContainText("oak worktops as a separate line");
  await expect(page.getByRole("heading", { name: /^Needs Reply\s*4$/ })).toBeVisible();

  // Recent news the AI summarised, and none of the junk, archived or snoozed.
  const updates = region(page, "Updates");
  await expect(updates.getByRole("link", { name: subject("website") })).toBeVisible();
  await expect(updates.getByRole("link", { name: subject("tax") })).toBeVisible();
  for (const key of ["prize", "news", "archived", "snoozed"]) await expect(page.getByRole("link", { name: subject(key) })).toHaveCount(0);
});

test("Filter narrows the Summary by channel and to what is waiting on others", async ({ page }) => {
  const choose = async (from: string, entry: string) => {
    await page.getByRole("button", { name: from, exact: true }).click();
    await page.getByRole("menuitemradio", { name: entry, exact: true }).click();
    await expect(page.getByRole("menu")).toHaveCount(0);
  };
  await choose("Filter", "Email");
  await expect(page.getByRole("button", { name: "Filter, Email" })).toBeVisible();
  await expect(region(page, "Needs Reply").getByRole("link", { name: subject("kitchen") })).toBeVisible();

  // The WhatsApp chats have no summary or reply flag, so none is on the page.
  await choose("Filter, Email", "WhatsApp");
  await expect(region(page, "Needs Reply")).toHaveCount(0);
  await expect(page.getByRole("link", { name: /Grace Dlamini/ })).toHaveCount(0);

  await choose("Filter, WhatsApp", "Waiting on Others");
  await expect(region(page, "Waiting On Others").getByRole("link", { name: subject("invoice") })).toBeVisible();
  await expect(region(page, "Needs Reply")).toHaveCount(0);

  await choose("Filter, Waiting on Others", "All");
  await expect(region(page, "Needs Reply")).toBeVisible();
});

test("Search Summary narrows by name and subject, and says when nothing matches", async ({ page }) => {
  const search = page.getByRole("searchbox", { name: "Search Summary" });
  await search.fill("Ava");
  await expect(page.getByRole("link", { name: subject("kitchen") })).toBeVisible();
  await expect(page.getByRole("link", { name: subject("lease") })).toHaveCount(0);
  await search.fill("zzzz no such thing");
  // The calendar section is a placeholder until its events have loaded, so this waits for them too.
  await expect(page.getByText("Nothing on the Summary matches your search.")).toBeVisible({ timeout: 20_000 });
  await search.fill("");
  await expect(page.getByRole("link", { name: subject("lease") })).toBeVisible();
});

test("Your Day shows the numbers, today's brief as text, and the week from the calendar", async ({ page, me }, testInfo) => {
  test.skip(isPhone(testInfo.project.name), "Your Day is the pane beside the list, which a phone does not show.");
  await expect(page.getByRole("heading", { level: 1, name: /^Good (Morning|Afternoon|Evening), Konva$/ })).toBeVisible();

  // The numbers: replies sent today (counted from the outbox, which other tests add to), what waits on others, promises.
  const card = (label: string) => page.getByText(label, { exact: true }).locator("xpath=..");
  const { count } = await admin().from("outbox").select("id", { count: "exact", head: true }).eq("user_id", me.userId).eq("status", "sent");
  await expect(card("Replied Today")).toContainText(String(count));
  await expect(card("Waiting On Others")).toContainText("1");
  await expect(card("Promises")).toContainText("3");

  await expect(page.getByRole("region", { name: "Today's Brief" }).getByText(BRIEF_SCRIPT)).toBeVisible();

  // The week: seven days from today, each event on its day with its time.
  const week = page.getByRole("region", { name: "This Week" });
  await expect(week.getByRole("link", { name: /Client Call With Ben/ })).toContainText("09:00");
  await expect(week.getByRole("link", { name: /Lease Walkthrough/ })).toContainText("14:00");
  await expect(week.getByRole("link", { name: /Team Planning Day/ })).toContainText("All Day");
  await expect(week.locator(`a[href^="/calendar?date=${dayIn(0)}"]`).first()).toBeVisible();
  await expect(week.locator(`a[href^="/calendar?date=${dayIn(6)}"]`).first()).toBeVisible();
});

test("the brief player asks for the brief to be spoken, the fake worker speaks it, and Listen becomes Pause", async ({ page, me }) => {
  // The browser is never asked to make a sound: play and pause are stand-ins that only say they happened.
  await page.addInitScript(() => {
    HTMLMediaElement.prototype.play = function () { this.dispatchEvent(new Event("play")); return Promise.resolve(); };
    HTMLMediaElement.prototype.pause = function () { this.dispatchEvent(new Event("pause")); };
  });
  await openSummary(page);
  await expect(page.getByRole("button", { name: "Listen" })).toBeVisible();
  expect(await briefStatus(me.project)).toBe("written");

  await page.getByRole("button", { name: "Listen" }).click();
  await expect.poll(() => briefStatus(me.project)).toBe("speak_pending");
  await speakBrief(me.project);

  await expect(page.getByRole("button", { name: "Pause" })).toBeVisible({ timeout: 20_000 });
  await page.getByRole("button", { name: "Pause" }).click();
  await expect(page.getByRole("button", { name: "Listen" })).toBeVisible();
  expect(await briefStatus(me.project)).toBe("ready");
});

test("Refresh Brief asks first, and Cancel leaves the brief as it is", async ({ page, me }) => {
  await page.getByRole("button", { name: "Refresh Brief" }).click();
  const dialog = page.getByRole("alertdialog", { name: "Refresh Brief?" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText(/3 briefs in any 24 hours/)).toBeVisible();
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect(dialog).toHaveCount(0);
  expect(await briefStatus(me.project)).not.toBe("pending");
});

test("Done on a promise saves it and takes it off the page", async ({ page, me }) => {
  const text = PROMISES[0].text;
  await region(page, "Promises").getByRole("checkbox", { name: `Done: ${text}` }).click();
  await expect(region(page, "Promises").getByText(text)).toHaveCount(0);
  await expect.poll(async () => (await admin().from("commitments").select("status").eq("user_id", me.userId).eq("seq", 1).single()).data?.status).toBe("done");
});

test("Snooze on a promise hides it until the chosen time", async ({ page, me }) => {
  const text = PROMISES[2].text;
  await region(page, "Promises").getByRole("button", { name: `Snooze: ${text}` }).click();
  await page.getByRole("menuitem", { name: "Tomorrow", exact: true }).click();
  await expect(region(page, "Promises").getByText(text)).toHaveCount(0);
  await expect.poll(async () => (await admin().from("commitments").select("snoozed_until").eq("user_id", me.userId).eq("seq", 3).single()).data?.snoozed_until).not.toBeNull();
});
