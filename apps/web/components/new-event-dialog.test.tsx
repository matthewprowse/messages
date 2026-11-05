// The New Event dialog (new-event-dialog.tsx): what it queues in calendar_outbox for a timed event and for an all-day
// event over several days (From and Until), what it refuses, and what it says when no calendar is connected.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mock } from "node:test";
import { screen, waitFor } from "@testing-library/react";
import { NewEventDialog } from "./new-event-dialog";
import { renderScreen } from "@/test/render";
import { FIELD } from "@messages/crypto/fields";
import { open } from "@/lib/vault";
import { CALENDAR_ACCOUNT, insertedInto, queueAccepts, workerFinishes } from "@/test/calendar-fixtures";
import { fakeKeyService } from "@/test/fake-keys";
import { AVA } from "@/test/fixtures";

// Event text is sealed with the user's key before it is queued, so the tests open it the way the worker would.
fakeKeyService();

// A fixed day far from today, so defaultEventTimes keeps it and nothing depends on the clock.
const DAY = "2030-03-14";
const local = (y: number, m: number, d: number, h = 0, min = 0) => new Date(y, m - 1, d, h, min).toISOString();

function renderDialog(props: Partial<Parameters<typeof NewEventDialog>[0]> = {}, accounts = [CALENDAR_ACCOUNT]) {
  const onOpenChange = mock.fn((_open: boolean) => undefined);
  const onQueued = mock.fn((_e: unknown) => undefined);
  const onCreated = mock.fn((_id: string) => undefined);
  const s = renderScreen(<NewEventDialog open onOpenChange={onOpenChange} onQueued={onQueued} onCreated={onCreated} {...props} />, { accounts, contacts: [AVA] });
  return { ...s, onOpenChange, onQueued, onCreated };
}

test("a timed event on a chosen hour is queued with its title, place and hour, then the dialog closes", async () => {
  queueAccepts("calendar_outbox", "queued-event-1");
  const { user, onOpenChange, onQueued, onCreated } = renderDialog({ day: DAY, time: "09:00" });
  await user.click(screen.getByLabelText("Title")); await user.paste("Site Visit");
  await user.click(screen.getByLabelText("Location")); await user.paste("12 Oak Lane");
  assert.ok(screen.getByRole("combobox", { name: "Start" }));
  await user.click(screen.getByRole("button", { name: "Create" }));
  await waitFor(() => assert.equal(onOpenChange.mock.callCount(), 1));
  assert.deepEqual(onOpenChange.mock.calls[0].arguments, [false]);
  const row = insertedInto("calendar_outbox");
  assert.ok(row);
  assert.notEqual(row.title, "Site Visit", "the title is sealed before it leaves the browser");
  assert.equal(await open(FIELD.eventTitle, row.title as string), "Site Visit");
  assert.equal(await open(FIELD.eventLocation, row.location as string), "12 Oak Lane");
  assert.equal(row.all_day, false);
  assert.equal(row.account_id, CALENDAR_ACCOUNT.id);
  // An hour from the chosen start, on exactly that day.
  assert.equal(row.starts_at, local(2030, 3, 14, 9));
  assert.equal(row.ends_at, local(2030, 3, 14, 10));
  assert.equal(onQueued.mock.callCount(), 1);
  // The worker creating it is passed on, so the page can load the events again.
  workerFinishes("calendar_outbox", "queued-event-1", { status: "created", error: null, html_link: null });
  await waitFor(() => assert.deepEqual(onCreated.mock.calls.map((c) => c.arguments), [["queued-event-1"]]));
});

test("an all-day plan over several days shows From and Until and is queued as one event to the day after Until", async () => {
  queueAccepts("calendar_outbox", "queued-event-2");
  const { user } = renderDialog({ day: DAY, endDay: "2030-03-16", allDay: true, title: "Cape Town Trip" });
  const from = screen.getByRole("button", { name: /^From/ });
  const until = screen.getByRole("button", { name: /^Until/ });
  assert.match(from.textContent ?? "", /Thursday, 14 March 2030/);
  assert.match(until.textContent ?? "", /Saturday, 16 March 2030/);
  // An all-day event has no times to pick.
  assert.equal(screen.queryByRole("combobox", { name: "Start" }), null);
  await user.click(screen.getByRole("button", { name: "Create" }));
  await waitFor(() => assert.ok(insertedInto("calendar_outbox")));
  const row = insertedInto("calendar_outbox")!;
  assert.equal(await open(FIELD.eventTitle, row.title as string), "Cape Town Trip");
  assert.equal(row.all_day, true);
  assert.equal(row.starts_at, local(2030, 3, 14));
  assert.equal(row.ends_at, local(2030, 3, 17));
  workerFinishes("calendar_outbox", "queued-event-2", { status: "created", error: null, html_link: null });
});

test("turning on All Day swaps Start and End for From and Until", async () => {
  const { user } = renderDialog({ day: DAY, time: "14:00" });
  assert.equal(screen.queryByRole("button", { name: /^From/ }), null);
  await user.click(screen.getByRole("switch", { name: "All Day" }));
  assert.ok(screen.getByRole("button", { name: /^From/ }));
  assert.ok(screen.getByRole("button", { name: /^Until/ }));
  assert.equal(screen.queryByRole("combobox", { name: "End" }), null);
});

test("Create with no title says to add one and queues nothing", async () => {
  const { user, onOpenChange } = renderDialog({ day: DAY, time: "09:00" });
  await user.click(screen.getByRole("button", { name: "Create" }));
  assert.ok(await screen.findByText("Add a title."));
  assert.equal(screen.getByLabelText("Title").getAttribute("aria-invalid"), "true");
  assert.equal((screen.getByRole("button", { name: "Create" }) as HTMLButtonElement).disabled, true);
  assert.equal(insertedInto("calendar_outbox"), undefined);
  assert.equal(onOpenChange.mock.callCount(), 0);
});

test("opened from a conversation it starts with the subject and the person as a guest", async () => {
  renderDialog({ day: DAY, time: "09:00", title: "Kitchen Renovation Quote", guests: [AVA.emails[0]] });
  assert.equal((screen.getByLabelText("Title") as HTMLInputElement).value, "Kitchen Renovation Quote");
  assert.ok(screen.getByText(AVA.name));
  assert.ok(screen.getByRole("switch", { name: "Send Invites" }));
  // Google Calendar can add a Meet link; the switch starts off.
  assert.equal(screen.getByRole("switch", { name: "Add Google Meet" }).getAttribute("aria-checked"), "false");
});

test("with no calendar connected it says how to connect one instead of showing the form", async () => {
  const { user, onOpenChange } = renderDialog({ day: DAY }, []);
  assert.ok(screen.getByText("Connect a Calendar to Create Events"));
  assert.equal(screen.getByRole("link", { name: "Connected Accounts" }).getAttribute("href"), "/settings/accounts");
  assert.equal(screen.queryByLabelText("Title"), null);
  await user.click(screen.getByRole("button", { name: "Close" }));
  assert.deepEqual(onOpenChange.mock.calls[0].arguments, [false]);
});

test("Cancel closes without queueing anything", async () => {
  const { user, onOpenChange } = renderDialog({ day: DAY, time: "09:00" });
  await user.click(screen.getByLabelText("Title")); await user.paste("Not This One");
  await user.click(screen.getByRole("button", { name: "Cancel" }));
  assert.deepEqual(onOpenChange.mock.calls[0].arguments, [false]);
  assert.equal(insertedInto("calendar_outbox"), undefined);
});
