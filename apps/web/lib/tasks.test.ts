import { test } from "node:test";
import assert from "node:assert/strict";
import { dueDay, isOverdue, mapTask, taskDetail, tasksByDay, tasksForToday, taskWhen, withTicks, type TaskRowOf } from "./tasks";
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
