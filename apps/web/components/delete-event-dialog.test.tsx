// The Delete Event dialog (delete-event-dialog.tsx): it queues a calendar_deletes row with the right scope, says when
// guests will be told, offers This Event or All Events for a repeating one, and keeps the dialog for a failed queue.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mock } from "node:test";
import { screen, waitFor } from "@testing-library/react";
import type { CalendarEvent } from "@/lib/calendar";
import { DeleteEventDialog } from "./delete-event-dialog";
import { fakeSupabase } from "@/test/fake-supabase";
import { renderScreen } from "@/test/render";
import { calendarEvent, daysFromNow, insertedInto, queueAccepts, workerFinishes } from "@/test/calendar-fixtures";

const VISIT = calendarEvent("event-visit", "Site Visit", daysFromNow(1, 10));

function renderDelete(event: CalendarEvent, error?: string) {
  const spies = { onClose: mock.fn(() => undefined), onStart: mock.fn((_t: string, _e: CalendarEvent, _s: string) => undefined), onDone: mock.fn((_t: string) => undefined), onFail: mock.fn((_t: string, _e: CalendarEvent, _r: string) => undefined) };
  const s = renderScreen(<DeleteEventDialog target={{ event, error }} calendar="Google Calendar" {...spies} />);
  return { ...s, ...spies };
}

test("Delete Event queues the delete for that event, hides it at once and reports when the worker is done", async () => {
  queueAccepts("calendar_deletes", "delete-1");
  const { user, onStart, onClose, onDone } = renderDelete(VISIT);
  assert.ok(screen.getByRole("alertdialog", { name: "Delete Site Visit?" }));
  assert.ok(screen.getByText("It is deleted from your Google Calendar."));
  await user.click(screen.getByRole("button", { name: "Delete Event" }));
  await waitFor(() => assert.equal(onStart.mock.callCount(), 1));
  assert.deepEqual(insertedInto("calendar_deletes"), { event_id: VISIT.id, account_id: VISIT.accountId, scope: "occurrence" });
  assert.deepEqual(onStart.mock.calls[0].arguments, ["delete-1", VISIT, "occurrence"]);
  assert.equal(onClose.mock.callCount(), 1);
  workerFinishes("calendar_deletes", "delete-1", { status: "done", error: null });
  await waitFor(() => assert.deepEqual(onDone.mock.calls.map((c) => c.arguments), [["delete-1"]]));
});

test("a repeating event offers This Event or All Events, and All Events deletes the series", async () => {
  queueAccepts("calendar_deletes", "delete-2");
  const { user, onStart } = renderDelete({ ...VISIT, seriesId: "series-1" });
  assert.ok(screen.getByText("This event repeats. Delete only this one, or every event in the series."));
  assert.ok(screen.getByRole("button", { name: "Delete This Event" }));
  await user.click(screen.getByRole("button", { name: "Delete All Events" }));
  await waitFor(() => assert.equal(onStart.mock.callCount(), 1));
  assert.equal(insertedInto("calendar_deletes")?.scope, "series");
  workerFinishes("calendar_deletes", "delete-2", { status: "done", error: null });
});

test("an event you invited people to says its guests are told", () => {
  renderDelete({ ...VISIT, attendees: [{ email: "ava.thompson@example.com", name: "Ava Thompson" }] as CalendarEvent["attendees"] });
  assert.ok(screen.getByText(/Its guests are told it is cancelled\./));
});

test("an invitation from someone else does not claim to tell the guests", () => {
  renderDelete({ ...VISIT, attendees: [{ email: "ava.thompson@example.com", name: "Ava Thompson" }] as CalendarEvent["attendees"], organizer: { name: "Ava Thompson", email: "ava.thompson@example.com" } });
  assert.equal(screen.queryByText(/guests are told/), null);
});

test("a delete that could not be queued keeps the dialog open and hides nothing", async () => {
  fakeSupabase.answer("from:calendar_deletes", { data: null, error: { message: "offline" } });
  const { user, onStart, onClose } = renderDelete(VISIT);
  await user.click(screen.getByRole("button", { name: "Delete Event" }));
  await waitFor(() => assert.equal(fakeSupabase.callsTo("from:calendar_deletes").length, 1));
  assert.equal(onStart.mock.callCount(), 0);
  assert.equal(onClose.mock.callCount(), 0);
});

test("the reason an earlier try failed is shown, and Cancel closes", async () => {
  const { user, onClose } = renderDelete(VISIT, "Reconnect Google to delete events.");
  assert.ok(screen.getByText("Reconnect Google to delete events."));
  await user.click(screen.getByRole("button", { name: "Cancel" }));
  assert.equal(onClose.mock.callCount(), 1);
});
