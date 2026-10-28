// Tests for tasks.ts: mapping task rows, due days and overdue rules, grouping by day, optimistic temp tasks and form
// validation.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  MAX_TITLE, dateOnly, dueDay, formOfTask, isOverdue, isTempTask, mapTask, taskChanged, taskDetail, taskOfWrite, taskProblem, tasksByDay, tasksForToday, taskWhen, taskWriteFields,
  tempTaskId, timeChoices, withTicks, type TaskForm, type TaskRowOf,
} from "./tasks";
import type { Task } from "./types";

// Local noon on Monday 26 October 2026, whatever zone the tests run in.
const now = new Date(2026, 9, 26, 12, 0);
const local = (d: number, h: number, m = 0) => new Date(2026, 9, d, h, m).toISOString();

function task(id: string, patch: Partial<Task> = {}): Task {
  return { id, accountId: "a", title: id, dueAt: "2026-10-26T00:00:00Z", dueAllDay: true, completed: false, ...patch };
}

const ids = (list: { task: Task }[] | undefined) => (list ?? []).map((t) => t.task.id);

test("a row becomes a task, with an empty title named and an odd priority dropped", () => {
  const row: TaskRowOf = {
    id: "t1", account_id: "a", list_name: " Clients ", title: "  ", notes: "", due_at: "2026-10-30T00:00:00Z", due_all_day: true,
    status: "completed", completed_at: "2026-10-26T08:00:00Z", priority: 7, contact_id: null,
  };
  const t = mapTask(row);
  assert.equal(t.title, "Untitled Task");
  assert.equal(t.listName, "Clients");
  assert.equal(t.notes, undefined);
  assert.equal(t.completed, true);
  assert.equal(t.priority, undefined);
  assert.equal(t.contactId, undefined);
});

test("an all-day task's day is its date as written, a timed one's is its local day", () => {
  assert.equal(dueDay(task("a", { dueAt: "2026-10-30T00:00:00Z" })), "2026-10-30");
  assert.equal(dueDay(task("b", { dueAt: local(30, 0, 30), dueAllDay: false })), "2026-10-30");
  assert.equal(dueDay(task("c", { dueAt: null })), null);
});

test("only open tasks due before today are overdue", () => {
  assert.equal(isOverdue(task("y", { dueAt: "2026-10-25T00:00:00Z" }), now), true);
  assert.equal(isOverdue(task("d", { dueAt: "2026-10-25T00:00:00Z", completed: true }), now), false);
  assert.equal(isOverdue(task("t"), now), false);
  // Due at nine this morning: late, but still today's, so it stays at its time.
  assert.equal(isOverdue(task("m", { dueAt: local(26, 9), dueAllDay: false }), now), false);
});

test("tasks sit on their due day, and open overdue ones move to today", () => {
  const days = ["2026-10-24", "2026-10-25", "2026-10-26", "2026-10-27"];
  const map = tasksByDay(
    [
      task("old", { dueAt: "2026-10-20T00:00:00Z" }),
      task("done-old", { dueAt: "2026-10-25T00:00:00Z", completed: true }),
      task("nine", { dueAt: local(26, 9), dueAllDay: false }),
      task("today"),
      task("tomorrow", { dueAt: local(27, 15), dueAllDay: false }),
      task("undated", { dueAt: null }),
      task("far", { dueAt: "2026-12-01T00:00:00Z" }),
    ],
    days,
    now,
  );
  assert.deepEqual(ids(map.get("2026-10-26")), ["old", "today", "nine"]);
  assert.deepEqual(ids(map.get("2026-10-25")), ["done-old"]);
  assert.deepEqual(ids(map.get("2026-10-27")), ["tomorrow"]);
  const [old, , nine] = map.get("2026-10-26")!;
  assert.deepEqual([old.overdue, old.timed, nine.overdue, nine.timed], [true, false, false, true]);
});

test("overdue tasks are not shown when today is not among the days", () => {
  const map = tasksByDay([task("old", { dueAt: "2026-10-20T00:00:00Z" })], ["2026-10-19", "2026-10-20", "2026-10-21"], now);
  assert.equal(map.size, 0);
});

test("a tick waiting on the worker shows at once, and the list is untouched without one", () => {
  const tasks = [task("a"), task("b", { completed: true })];
  assert.equal(withTicks(tasks, {}), tasks);
  const ticked = withTicks(tasks, { a: { token: "x", done: true }, b: { token: "y", done: true } });
  assert.deepEqual(ticked.map((t) => [t.completed, t.pending]), [[true, true], [true, true]]);
});

test("today's list keeps open tasks and ones being ticked, overdue first", () => {
  const list = tasksForToday(
    [task("today"), task("old", { dueAt: "2026-10-22T00:00:00Z" }), task("done", { completed: true }), task("ticking", { completed: true, pending: true })],
    now,
  );
  assert.deepEqual(list.map((t) => t.task.id), ["old", "ticking", "today"]);
});

test("a task row says when and where it is from", () => {
  const timeOf = () => "09:00";
  assert.equal(taskWhen({ task: task("a"), overdue: true, timed: false }, timeOf), "Overdue");
  assert.equal(taskWhen({ task: task("a", { dueAllDay: false }), overdue: false, timed: true }, timeOf), "09:00");
  assert.equal(taskWhen({ task: task("a"), overdue: false, timed: false }, timeOf), "All Day");
  assert.equal(taskWhen({ task: task("a", { pending: true }), overdue: true, timed: false }, timeOf), "Saving");
  assert.equal(taskDetail({ listName: "Clients" }, "Google Tasks"), "Clients · Google Tasks");
  assert.equal(taskDetail({}, undefined), "Task");
});

test("a form becomes the fields of a queued task: a date alone is all-day, a time is that local time", () => {
  const form: TaskForm = { title: "  Call Sam ", notes: " ", accountId: "a", date: "2026-11-03", time: "", priority: 0 };
  assert.deepEqual(taskWriteFields(form, "microsoft_todo"), { title: "Call Sam", notes: null, due_at: "2026-11-03T00:00:00Z", due_all_day: true, priority: null });
  const timed = taskWriteFields({ ...form, time: "09:30", priority: 1, notes: "Offer" }, "microsoft_todo");
  assert.equal(timed.due_at, new Date(2026, 10, 3, 9, 30).toISOString());
  assert.deepEqual([timed.due_all_day, timed.priority, timed.notes], [false, 1, "Offer"]);
  assert.equal(taskWriteFields({ ...form, date: "", time: "09:30" }, "microsoft_todo").due_at, null);
});

test("Google Tasks keeps the date only: no time and no priority", () => {
  const form: TaskForm = { title: "Call Sam", notes: "", accountId: "a", date: "2026-11-03", time: "09:30", priority: 2 };
  assert.deepEqual(taskWriteFields(form, "google_tasks"), { title: "Call Sam", notes: null, due_at: "2026-11-03T00:00:00Z", due_all_day: true, priority: null });
  assert.equal(dateOnly("google_tasks"), true);
  assert.equal(dateOnly("microsoft_todo"), false);
});

test("a form needs a title and a date", () => {
  const form: TaskForm = { title: "Call Sam", notes: "", accountId: "a", date: "2026-11-03", time: "", priority: 0 };
  assert.equal(taskProblem(form), null);
  assert.equal(taskProblem({ ...form, date: "" })?.field, "date");
  assert.equal(taskProblem({ ...form, title: "  " })?.field, "title");
  assert.equal(taskProblem({ ...form, date: "", time: "09:30" })?.field, "date");
  assert.equal(taskProblem({ ...form, title: "x".repeat(MAX_TITLE + 1) })?.field, "title");
});

test("a task fills the form it is edited in, and the form knows when nothing changed", () => {
  const allDay = task("a", { title: "Send the offer", notes: "Signed", dueAt: "2026-10-30T00:00:00Z", priority: 3 });
  assert.deepEqual(formOfTask(allDay), { title: "Send the offer", notes: "Signed", accountId: "a", date: "2026-10-30", time: "", priority: 3 });
  const timed = task("b", { dueAt: local(30, 9, 30), dueAllDay: false });
  assert.deepEqual([formOfTask(timed).date, formOfTask(timed).time], ["2026-10-30", "09:30"]);
  assert.equal(formOfTask(task("c", { title: "Untitled Task" })).title, "");
  assert.equal(taskChanged(formOfTask(allDay), allDay), false);
  assert.equal(taskChanged({ ...formOfTask(allDay), notes: "Signed " }, allDay), false);
  assert.equal(taskChanged({ ...formOfTask(allDay), date: "2026-10-31" }, allDay), true);
});

test("a task shown while it is made is pending, and has a temporary id until it is stored", () => {
  const id = tempTaskId();
  assert.equal(isTempTask({ id }), true);
  assert.equal(isTempTask({ id: "6f1d" }), false);
  const shown = taskOfWrite(id, "a", { title: "Call Sam", notes: null, due_at: "2026-11-03T00:00:00Z", due_all_day: true, priority: 1 });
  assert.deepEqual([shown.pending, shown.completed, shown.priority, shown.notes], [true, false, 1, undefined]);
  const changed = taskOfWrite("t1", "a", { title: "New", notes: null, due_at: null, due_all_day: true, priority: null }, task("t1", { completed: true, listName: "Clients" }));
  assert.deepEqual([changed.completed, changed.listName, changed.title], [true, "Clients", "New"]);
});

test("the times offered are quarter hours, with an odd one already set kept", () => {
  assert.equal(timeChoices("").length, 96);
  assert.equal(timeChoices("")[37], "09:15");
  assert.equal(timeChoices("09:20").includes("09:20"), true);
});
