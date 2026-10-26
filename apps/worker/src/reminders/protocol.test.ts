import assert from "node:assert/strict";
import { test } from "node:test";
import { dueAt, MAX_REMINDERS, parseReport, parseSync, taskFields, taskPriority } from "./protocol";

const reminder = (over: Record<string, unknown> = {}) => ({ id: "R1", listId: "L1", title: "Send the offer to Priya", notes: null, due: null, completed: false, completedAt: null, priority: 0, ...over });
const sync = (over: Record<string, unknown> = {}) => ({ version: 1, access: "full", timeZone: "Africa/Johannesburg", lists: [{ id: "L1", name: "Clients" }], reminders: [reminder()], ...over });

test("a day with no time is due all day, at midnight UTC of that day", () => {
  assert.deepEqual(dueAt({ date: "2026-10-24" }, "Africa/Johannesburg"), { due_at: "2026-10-24T00:00:00.000Z", due_all_day: true });
  // The Mac's zone does not move a whole day.
  assert.deepEqual(dueAt({ date: "2026-10-24" }, "Pacific/Auckland"), { due_at: "2026-10-24T00:00:00.000Z", due_all_day: true });
});

test("a time with a zone is converted to UTC", () => {
  // Johannesburg is UTC+2 all year; New York is UTC-4 until 1 Nov, then UTC-5.
  assert.deepEqual(dueAt({ date: "2026-10-24", time: "10:00", timeZone: "Africa/Johannesburg" }, null), { due_at: "2026-10-24T08:00:00.000Z", due_all_day: false });
  assert.deepEqual(dueAt({ date: "2026-10-24", time: "10:00:30", timeZone: "America/New_York" }, "Africa/Johannesburg"), { due_at: "2026-10-24T14:00:30.000Z", due_all_day: false });
  assert.deepEqual(dueAt({ date: "2026-12-01", time: "10:00", timeZone: "America/New_York" }, null), { due_at: "2026-12-01T15:00:00.000Z", due_all_day: false });
});

test("a floating time is read in the Mac's zone, else as UTC", () => {
  assert.deepEqual(dueAt({ date: "2026-10-24", time: "09:15" }, "Africa/Johannesburg"), { due_at: "2026-10-24T07:15:00.000Z", due_all_day: false });
  assert.deepEqual(dueAt({ date: "2026-10-24", time: "09:15" }, null), { due_at: "2026-10-24T09:15:00.000Z", due_all_day: false });
});

test("no date, or one that is not a date, is no due date", () => {
  assert.deepEqual(dueAt(null, null), { due_at: null, due_all_day: true });
  assert.deepEqual(dueAt({ date: "2026-02-30" }, null), { due_at: null, due_all_day: true });
  assert.deepEqual(dueAt({ date: "24/10/2026" }, null), { due_at: null, due_all_day: true });
  // A time that is not one leaves the day.
  assert.deepEqual(dueAt({ date: "2026-10-24", time: "25:00" }, null), { due_at: "2026-10-24T00:00:00.000Z", due_all_day: true });
});

test("priority 1 to 9 becomes high, medium or low", () => {
  assert.deepEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, -1].map(taskPriority), [null, 1, 1, 1, 1, 2, 3, 3, 3, 3, null, null]);
});

test("a reminder becomes a task row, completed or open", () => {
  const parsed = parseSync(
    sync({
      reminders: [
        reminder({ title: "  Call Sam  ", notes: "  Re: the lease\n", due: { date: "2026-10-24", time: "10:00", timeZone: "Africa/Johannesburg" }, priority: 1 }),
        reminder({ id: "R2", completed: true, completedAt: "2026-10-23T12:00:00Z", priority: 9, notes: "   " }),
        reminder({ id: "R3", listId: "L2", completed: false, completedAt: "2026-10-23T12:00:00Z" }),
      ],
    }),
  );
  assert.ok(parsed.ok);
  const [open, done, other] = parsed.value.reminders.map((r) => taskFields(r, parsed.value));
  assert.deepEqual(open, {
    provider_task_id: "R1",
    list_id: "L1",
    list_name: "Clients",
    title: "Call Sam",
    notes: "Re: the lease",
    due_at: "2026-10-24T08:00:00.000Z",
    due_all_day: false,
    status: "open",
    completed_at: null,
    priority: 1,
  });
  assert.equal(done.status, "completed");
  assert.equal(done.completed_at, "2026-10-23T12:00:00.000Z");
  assert.equal(done.priority, 3);
  assert.equal(done.notes, null);
  // A list the relay did not name has no name, and an open reminder keeps no completion date.
  assert.equal(other.list_name, null);
  assert.equal(other.completed_at, null);
});

test("a sync is checked before anything is stored", () => {
  assert.deepEqual(parseSync(null), { ok: false, error: "bad_body" });
  assert.deepEqual(parseSync(sync({ version: 2 })), { ok: false, error: "bad_version" });
  assert.deepEqual(parseSync(sync({ reminders: "nope" })), { ok: false, error: "bad_body" });
  assert.deepEqual(parseSync(sync({ reminders: Array.from({ length: MAX_REMINDERS + 1 }, (_, i) => reminder({ id: `R${i}` })) })), { ok: false, error: "too_large" });

  // Reminders that make no sense are dropped; one listed twice is kept once; an unknown zone is ignored.
  const parsed = parseSync(sync({ timeZone: "Mars/Olympus", reminders: [reminder(), reminder({ title: "again" }), { id: "", listId: "L1" }, { listId: "L1" }, "x", reminder({ id: "R9", title: 42, priority: 2.5 })] }));
  assert.ok(parsed.ok);
  assert.equal(parsed.value.timeZone, null);
  assert.deepEqual(parsed.value.reminders.map((r) => [r.id, r.title, r.priority]), [["R1", "Send the offer to Priya", 0], ["R9", "", 0]]);
});

test("a Mac that has not allowed access sends nothing else", () => {
  const parsed = parseSync({ version: 1, access: "denied" });
  assert.ok(parsed.ok);
  assert.equal(parsed.value.access, "denied");
  assert.equal(parsed.value.reminders.length, 0);
});

test("a report from the relay becomes words for the app", () => {
  assert.deepEqual(parseReport({ ok: true }), { ok: true, value: { ok: true } });
  const missing = parseReport({ ok: false, error: "not_found" });
  assert.ok(missing.ok && !missing.value.ok && /no longer in Reminders/.test(missing.value.error));
  // Free text from the relay is never shown as it is.
  const odd = parseReport({ ok: false, error: "<b>anything</b>" });
  assert.ok(odd.ok && !odd.value.ok && odd.value.error === "Reminders on your Mac could not make this change. Try again.");
  assert.deepEqual(parseReport({ ok: "yes" }), { ok: false, error: "bad_body" });
});
