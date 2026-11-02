// Tests for todo-task.ts: how a Graph To Do task becomes a row, mainly due dates across zones, reminders and
// notes, plus the write payloads and failure mapping.

import assert from "node:assert/strict";
import { test } from "node:test";
import { defaultTodoList, dueDay, graphInstant, importanceOf, statusPatch, storedTodoTask, taskDue, taskNotes, throttleWait, todoUpdateFailure, todoWriteBody, wallClock, type GraphTodoTask } from "./todo-task";
import { ianaZone } from "./windows-zones";

const SA = "Africa/Johannesburg";
const ctx = { userId: "u1", accountId: "a1", list: { id: "list1", name: "Clients" }, userZone: SA };

test("names Windows and IANA zones the way Intl knows them", () => {
  assert.equal(ianaZone("South Africa Standard Time"), "Africa/Johannesburg");
  assert.equal(ianaZone("south africa standard time"), "Africa/Johannesburg");
  assert.equal(ianaZone("UTC"), "UTC");
  assert.equal(ianaZone("tzone://Microsoft/Utc"), "UTC");
  assert.equal(ianaZone("GMT Standard Time"), "Europe/London");
  assert.equal(ianaZone("Africa/Johannesburg"), "Africa/Johannesburg");
  assert.equal(ianaZone("Mars Standard Time"), null);
  assert.equal(ianaZone("Not/AZone"), null);
  assert.equal(ianaZone(""), null);
  assert.equal(ianaZone(undefined), null);
});

test("reads a Graph date and time in its own zone", () => {
  assert.equal(graphInstant({ dateTime: "2026-11-03T09:00:00.0000000", timeZone: "South Africa Standard Time" })?.toISOString(), "2026-11-03T07:00:00.000Z");
  assert.equal(graphInstant({ dateTime: "2026-11-03T07:00:00.0000000", timeZone: "UTC" })?.toISOString(), "2026-11-03T07:00:00.000Z");
  // British Summer Time is an hour ahead of UTC, winter time is not.
  assert.equal(graphInstant({ dateTime: "2026-07-14T09:00:00", timeZone: "GMT Standard Time" })?.toISOString(), "2026-07-14T08:00:00.000Z");
  assert.equal(graphInstant({ dateTime: "2026-12-14T09:00:00", timeZone: "GMT Standard Time" })?.toISOString(), "2026-12-14T09:00:00.000Z");
  // A zone it does not know is read as UTC, as Graph sends by default.
  assert.equal(graphInstant({ dateTime: "2026-11-03T09:00:00", timeZone: "Mars Standard Time" })?.toISOString(), "2026-11-03T09:00:00.000Z");
  assert.equal(graphInstant({ dateTime: "2026-11-03T09:00:00" })?.toISOString(), "2026-11-03T09:00:00.000Z");
  assert.equal(graphInstant({ dateTime: "soon", timeZone: "UTC" }), null);
  assert.equal(graphInstant(null), null);
});

test("a due date at midnight in its own zone is that day, whatever your zone", () => {
  assert.equal(dueDay({ dateTime: "2026-11-03T00:00:00.0000000", timeZone: "UTC" }, SA), "2026-11-03");
  assert.equal(dueDay({ dateTime: "2026-11-03T00:00:00.0000000", timeZone: "South Africa Standard Time" }, SA), "2026-11-03");
  assert.equal(dueDay({ dateTime: "2026-11-03T00:00:00.0000000", timeZone: "South Africa Standard Time" }, "UTC"), "2026-11-03");
  assert.equal(dueDay({ dateTime: "2026-11-03T00:00:00.0000000", timeZone: "UTC" }, "America/New_York"), "2026-11-03");
  assert.equal(dueDay({ dateTime: "2026-11-03T00:00:00", timeZone: "Mars Standard Time" }, SA), "2026-11-03");
  assert.equal(dueDay({ dateTime: "2026-11-03", timeZone: "UTC" }, SA), "2026-11-03");
});

test("a due date that is your midnight written in UTC is the day it starts in your zone", () => {
  // 3 November in South Africa (UTC+2), as Graph often sends it.
  assert.equal(dueDay({ dateTime: "2026-11-02T22:00:00.0000000", timeZone: "UTC" }, SA), "2026-11-03");
  // Graph's own example: 25 August in New York (UTC-4 in summer).
  assert.equal(dueDay({ dateTime: "2020-08-25T04:00:00.0000000", timeZone: "UTC" }, "America/New_York"), "2020-08-25");
  // London in summer (UTC+1) and in winter (UTC+0, so midnight UTC above).
  assert.equal(dueDay({ dateTime: "2026-07-14T23:00:00.0000000", timeZone: "UTC" }, "Europe/London"), "2026-07-15");
  // A zone set a little wrong still lands on the nearest midnight's day.
  assert.equal(dueDay({ dateTime: "2026-11-02T22:00:00.0000000", timeZone: "UTC" }, "UTC"), "2026-11-03");
  assert.equal(dueDay({ dateTime: "2026-11-02T22:00:00.0000000", timeZone: "UTC" }, "Europe/London"), "2026-11-03");
  assert.equal(dueDay({ dateTime: "2026-11-03T01:00:00.0000000", timeZone: "UTC" }, "UTC"), "2026-11-03");
});

test("no due date, or one that cannot be read, is no due day", () => {
  assert.equal(dueDay(undefined, SA), null);
  assert.equal(dueDay(null, SA), null);
  assert.equal(dueDay({ dateTime: "", timeZone: "UTC" }, SA), null);
  assert.equal(dueDay({ dateTime: "3 November", timeZone: "UTC" }, SA), null);
});

test("a due date without a reminder is all day, at midnight UTC", () => {
  assert.deepEqual(taskDue({ dueDateTime: { dateTime: "2026-11-02T22:00:00.0000000", timeZone: "UTC" } }, SA), {
    due_at: "2026-11-03T00:00:00Z",
    due_all_day: true,
  });
  assert.deepEqual(taskDue({ dueDateTime: { dateTime: "2026-11-03T00:00:00.0000000", timeZone: "South Africa Standard Time" }, isReminderOn: false }, SA), {
    due_at: "2026-11-03T00:00:00Z",
    due_all_day: true,
  });
  assert.deepEqual(taskDue({}, SA), { due_at: null, due_all_day: true });
});

test("a reminder on the due day makes the task due at that time", () => {
  const due = { dateTime: "2026-11-02T22:00:00.0000000", timeZone: "UTC" };
  // 09:00 in South Africa, sent in its zone or in UTC.
  assert.deepEqual(
    taskDue({ dueDateTime: due, isReminderOn: true, reminderDateTime: { dateTime: "2026-11-03T09:00:00.0000000", timeZone: "South Africa Standard Time" } }, SA),
    { due_at: "2026-11-03T07:00:00.000Z", due_all_day: false },
  );
  assert.deepEqual(taskDue({ dueDateTime: due, isReminderOn: true, reminderDateTime: { dateTime: "2026-11-03T07:00:00.0000000", timeZone: "UTC" } }, SA), {
    due_at: "2026-11-03T07:00:00.000Z",
    due_all_day: false,
  });
  // 00:30 on the 3rd in South Africa is still the 2nd in UTC: the day is read in your zone.
  assert.deepEqual(taskDue({ dueDateTime: due, isReminderOn: true, reminderDateTime: { dateTime: "2026-11-02T22:30:00.0000000", timeZone: "UTC" } }, SA), {
    due_at: "2026-11-02T22:30:00.000Z",
    due_all_day: false,
  });
  // 23:30 on the 3rd in South Africa.
  assert.deepEqual(taskDue({ dueDateTime: due, isReminderOn: true, reminderDateTime: { dateTime: "2026-11-03T21:30:00.0000000", timeZone: "UTC" } }, SA), {
    due_at: "2026-11-03T21:30:00.000Z",
    due_all_day: false,
  });
  // When isReminderOn is left out, the reminder still counts.
  assert.equal(taskDue({ dueDateTime: due, reminderDateTime: { dateTime: "2026-11-03T07:00:00", timeZone: "UTC" } }, SA).due_all_day, false);
});

test("a reminder on another day, or one turned off, leaves the task all day", () => {
  const due = { dateTime: "2026-11-03T00:00:00.0000000", timeZone: "UTC" };
  // The evening before in South Africa.
  assert.deepEqual(taskDue({ dueDateTime: due, isReminderOn: true, reminderDateTime: { dateTime: "2026-11-02T18:00:00.0000000", timeZone: "South Africa Standard Time" } }, SA), {
    due_at: "2026-11-03T00:00:00Z",
    due_all_day: true,
  });
  // 23:30 UTC on the 3rd is already the 4th in South Africa.
  assert.equal(taskDue({ dueDateTime: due, isReminderOn: true, reminderDateTime: { dateTime: "2026-11-03T23:30:00", timeZone: "UTC" } }, SA).due_all_day, true);
  assert.equal(taskDue({ dueDateTime: due, isReminderOn: true, reminderDateTime: { dateTime: "2026-11-03T23:30:00", timeZone: "UTC" } }, "UTC").due_all_day, false);
  assert.equal(taskDue({ dueDateTime: due, isReminderOn: false, reminderDateTime: { dateTime: "2026-11-03T09:00:00", timeZone: "UTC" } }, SA).due_all_day, true);
  // A reminder alone gives no due date.
  assert.deepEqual(taskDue({ isReminderOn: true, reminderDateTime: { dateTime: "2026-11-03T09:00:00", timeZone: "UTC" } }, SA), { due_at: null, due_all_day: true });
});

test("notes come through as plain text", () => {
  assert.equal(taskNotes({ content: "Ask about the bond.\r\nBring the offer.", contentType: "text" }), "Ask about the bond.\nBring the offer.");
  assert.equal(taskNotes({ content: "<html><body><p>Ask about the <b>bond</b>.</p><p>Bring the offer.</p></body></html>", contentType: "html" }), "Ask about the bond.\nBring the offer.");
  assert.equal(taskNotes({ content: "  ", contentType: "text" }), null);
  assert.equal(taskNotes({ content: "", contentType: "text" }), null);
  assert.equal(taskNotes(null), null);
});

test("stores a To Do task as a tasks row", () => {
  const task: GraphTodoTask = {
    id: "t1",
    "@odata.etag": 'W/"abc=="',
    title: " Send Priya the signed offer ",
    body: { content: "Before Friday.", contentType: "text" },
    importance: "high",
    status: "inProgress",
    isReminderOn: false,
    dueDateTime: { dateTime: "2026-11-02T22:00:00.0000000", timeZone: "UTC" },
    lastModifiedDateTime: "2026-10-26T08:00:00Z",
  };
  assert.deepEqual(storedTodoTask(task, ctx), {
    user_id: "u1",
    account_id: "a1",
    provider_task_id: "t1",
    list_id: "list1",
    list_name: "Clients",
    title: "Send Priya the signed offer",
    notes: "Before Friday.",
    due_at: "2026-11-03T00:00:00Z",
    due_all_day: true,
    status: "open",
    completed_at: null,
    priority: 1,
    provider_meta: { list_id: "list1", etag: 'W/"abc=="' },
  });
});

test("maps importance and status", () => {
  const base: GraphTodoTask = { id: "t1", title: "Call back" };
  assert.equal(storedTodoTask({ ...base, importance: "normal" }, ctx).priority, null);
  assert.equal(storedTodoTask({ ...base, importance: "low" }, ctx).priority, 3);
  assert.equal(storedTodoTask(base, ctx).priority, null);
  assert.equal(storedTodoTask({ ...base, title: null }, ctx).title, "");
  assert.equal(storedTodoTask(base, ctx).due_at, null);
  for (const status of ["notStarted", "inProgress", "waitingOnOthers", "deferred"]) assert.equal(storedTodoTask({ ...base, status }, ctx).status, "open");

  const done = storedTodoTask({ ...base, status: "completed", completedDateTime: { dateTime: "2026-10-25T22:00:00.0000000", timeZone: "UTC" } }, ctx);
  assert.equal(done.status, "completed");
  assert.equal(done.completed_at, "2026-10-25T22:00:00.000Z");
  // Without a completion time, when it was last changed.
  assert.equal(storedTodoTask({ ...base, status: "completed", lastModifiedDateTime: "2026-10-26T08:00:00Z" }, ctx).completed_at, "2026-10-26T08:00:00Z");
});

test("ticking off and reopening send the status To Do knows", () => {
  assert.deepEqual(statusPatch("complete"), { status: "completed" });
  assert.deepEqual(statusPatch("reopen"), { status: "notStarted" });
  assert.equal(statusPatch("delete"), null);
  assert.equal(todoUpdateFailure(404), "This task is no longer in Microsoft To Do.");
  assert.match(todoUpdateFailure(403), /Reconnect Microsoft in Settings/);
  assert.equal(todoUpdateFailure(null), "Microsoft To Do could not be reached. Try again.");
  assert.equal(todoUpdateFailure(500), "Microsoft To Do could not be reached. Try again.");
});

test("a throttled sync waits as long as Retry-After asks, within limits", () => {
  const now = Date.parse("2026-10-26T08:00:00Z");
  assert.equal(throttleWait("120", 5_000, now), 120_000);
  assert.equal(throttleWait("2", 5_000, now), 5_000); // never shorter than the backoff
  assert.equal(throttleWait(null, 5_000, now), 5_000);
  assert.equal(throttleWait("later", 5_000, now), 5_000);
  assert.equal(throttleWait("Mon, 26 Oct 2026 08:03:00 GMT", 5_000, now), 180_000);
  assert.equal(throttleWait("86400", 5_000, now), 15 * 60_000);
});

test("a new task goes in To Do's default list, else the first", () => {
  assert.equal(defaultTodoList([{ id: "a", wellknownListName: "none" }, { id: "b", wellknownListName: "defaultList" }])?.id, "b");
  assert.equal(defaultTodoList([{ id: "a" }, { id: "b" }])?.id, "a");
  assert.equal(defaultTodoList([]), null);
});

test("priorities become To Do's importance, with medium as normal", () => {
  assert.deepEqual([1, 2, 3, null].map((p) => importanceOf(p as 1 | 2 | 3 | null)), ["high", "normal", "low", "normal"]);
});

test("a wall clock is the time a zone shows", () => {
  assert.equal(wallClock(new Date("2026-11-03T07:30:00Z"), SA), "2026-11-03T09:30:00.0000000");
  assert.equal(wallClock(new Date("2026-11-02T22:00:00Z"), SA), "2026-11-03T00:00:00.0000000");
});

test("a task made in the app is sent with its day, and a time as a reminder on that day", () => {
  const base = { title: "Call Sam", notes: "Ask about the offer", priority: 1 as const };
  const allDay = todoWriteBody({ ...base, dueAt: "2026-11-03T00:00:00.000Z", dueAllDay: true }, SA, true);
  assert.deepEqual(allDay, {
    title: "Call Sam",
    importance: "high",
    body: { content: "Ask about the offer", contentType: "text" },
    dueDateTime: { dateTime: "2026-11-03T00:00:00.0000000", timeZone: SA },
  });
  const timed = todoWriteBody({ ...base, dueAt: "2026-11-03T07:30:00.000Z", dueAllDay: false }, SA, true);
  assert.deepEqual(timed.dueDateTime, { dateTime: "2026-11-03T00:00:00.0000000", timeZone: SA });
  assert.deepEqual(timed.reminderDateTime, { dateTime: "2026-11-03T09:30:00.0000000", timeZone: SA });
  assert.equal(timed.isReminderOn, true);
  // Read back the way a sync reads it: the same day, at the same time.
  const back = storedTodoTask({ id: "t", ...timed }, ctx);
  assert.deepEqual([back.due_at, back.due_all_day, back.priority], ["2026-11-03T07:30:00.000Z", false, 1]);
});

test("changing a task clears the date and notes it no longer has, creating leaves them out", () => {
  const none = { title: "Call Sam", notes: null, dueAt: null, dueAllDay: true, priority: null };
  const created = todoWriteBody(none, SA, true);
  assert.equal("dueDateTime" in created, false);
  assert.deepEqual(created.body, { content: "", contentType: "text" });
  const changed = todoWriteBody(none, SA, false);
  assert.equal(changed.dueDateTime, null);
  assert.equal(changed.reminderDateTime, null);
  assert.equal(changed.isReminderOn, false);
  assert.equal(changed.importance, "normal");
  // A day without a time turns an earlier reminder off.
  const dayOnly = todoWriteBody({ ...none, dueAt: "2026-11-03T00:00:00.000Z" }, SA, false);
  assert.deepEqual([dayOnly.reminderDateTime, dayOnly.isReminderOn], [null, false]);
});

test("a rejected change is worded", () => {
  assert.match(todoUpdateFailure(400), /did not accept/);
});
