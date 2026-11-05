// Your Day (your-day.tsx), beside the Summary with nothing open: the greeting, the three numbers (replied today, waiting
// on others, promises), today's brief as text, and the week row with each event on its day. Everything is read through
// the fake Supabase client and the fake store.

import { test } from "node:test";
import assert from "node:assert/strict";
import { screen, waitFor, within } from "@testing-library/react";
import { dayKey } from "@/lib/dates";
import { YourDay } from "./your-day";
import { fakeSupabase } from "@/test/fake-supabase";
import { renderScreen } from "@/test/render";
import { daysFromNow } from "@/test/calendar-fixtures";
import { GARDEN, LEASE, minutesAgo } from "@/test/fixtures";

/** A number card's value, read from the card that holds the label. */
const stat = (label: string) => screen.getByText(label).parentElement?.textContent?.replace(label, "");

const visit = daysFromNow(1, 11);
// Sent three days ago with an answer expected, so it counts as waiting on the other person.
const waitingOn = { ...GARDEN, id: "thread-waiting", lastFromMe: true, waiting: true, lastMessageAt: minutesAgo(3 * 24 * 60) };

function answerEverything() {
  fakeSupabase.answer("from:outbox", { data: null, error: null, count: 4 });
  fakeSupabase.answer("from:briefs", { data: { id: "brief-1", status: "ready", parts: null, voice: null, updated_at: new Date().toISOString(), script: "Three clients wrote overnight. Ava is waiting on the quote." }, error: null });
  fakeSupabase.answer("from:commitments", { data: [{ id: "promise-1", thread_id: LEASE.id, message_id: "m-9", owner: "me", text: "Send the signed lease", due_on: dayKey(new Date()), status: "open", snoozed_until: null }], error: null });
  fakeSupabase.answer("from:calendar_events", { data: [{ id: "event-visit", account_id: "account-calendar", title: "Site Visit", starts_at: visit.toISOString(), ends_at: new Date(visit.getTime() + 3_600_000).toISOString(), all_day: false, location: null, calendar_name: null, series_id: null }], error: null });
}

test("it greets you by your first name and shows the three numbers", async () => {
  answerEverything();
  renderScreen(<YourDay />, { auth: true, threads: [LEASE, waitingOn], profile: { name: "Sam Example" } });
  assert.match(screen.getByRole("heading", { level: 1 }).textContent ?? "", /^Good (Morning|Afternoon|Evening), Sam$/);
  await waitFor(() => assert.equal(stat("Replied Today"), "4"));
  assert.equal(stat("Waiting On Others"), "1");
  await waitFor(() => assert.equal(stat("Promises"), "1"));
});

test("today's brief is shown as text", async () => {
  answerEverything();
  renderScreen(<YourDay />, { auth: true });
  const brief = await screen.findByRole("region", { name: "Today's Brief" });
  assert.ok(within(brief).getByText("Three clients wrote overnight. Ava is waiting on the quote."));
});

test("the week row has seven days from today, each opening Calendar, with an event on its own day", async () => {
  answerEverything();
  renderScreen(<YourDay />, { auth: true });
  const week = screen.getByRole("region", { name: "This Week" });
  await waitFor(() => assert.ok(within(week).getByRole("link", { name: /Site Visit/ })));
  const days = within(week).getAllByRole("link").filter((l) => /^\/calendar\?date=[\d-]+$/.test(l.getAttribute("href") ?? ""));
  assert.equal(days.length, 7);
  assert.equal(days[0].getAttribute("href"), `/calendar?date=${dayKey(new Date())}`);
  assert.equal(within(week).getByRole("link", { name: /Site Visit/ }).getAttribute("href"), `/calendar?date=${dayKey(visit)}&event=event-visit`);
  assert.equal(within(week).getByRole("link", { name: "See All" }).getAttribute("href"), "/calendar");
});

test("with no brief yet there is no brief card, and the numbers wait while loading", async () => {
  renderScreen(<YourDay />, { overrides: { loading: true } });
  // Nothing sent today yet reads as a real zero once the count lands.
  await waitFor(() => assert.equal(stat("Replied Today"), "0"));
  assert.equal(screen.queryByRole("region", { name: "Today's Brief" }), null);
  // While the store is still loading, the waiting count is a placeholder, never a made-up zero.
  assert.equal(stat("Waiting On Others"), "");
});
