import assert from "node:assert/strict";
import { test } from "node:test";
import { FIELD } from "@messages/crypto/fields";
import {
  NOT_A_TASK_ACCOUNT,
  NOT_SUPPORTED_WRITE,
  TaskUpdateError,
  planTaskUpdates,
  taskKey,
  taskWriteOf,
  taskAccountProblem,
  taskFailure,
  taskFailureCode,
  taskRow,
  taskStatusPatch,
  type Sealer,
  type TaskInput,
  type TaskUpdateRow,
} from "./rows";

/** Seals as "<field>:<value>", so a test sees which field each value went under. */
const sealer: Sealer = async (_user, field, value) => (value == null ? null : `${field}:${value}`);

function input(patch: Partial<TaskInput> = {}): TaskInput {
  return { provider_task_id: "p1", list_id: "l1", title: "Send the offer", ...patch };
}

function update(id: string, taskId: string | null, at: string, patch: Partial<TaskUpdateRow> = {}): TaskUpdateRow {
  return { id, user_id: "u", task_id: taskId, action: "complete", status: "queued", error: null, created_at: at, account_id: null, title: null, notes: null, due_at: null, due_all_day: false, priority: null, ...patch };
}

test("a task is stored with its text sealed under the task fields", async () => {
  const row = await taskRow("u", "a", input({ title: "  Send the offer ", notes: "Signed copy", list_name: "Clients" }), sealer);
  assert.equal(row.user_id, "u");
  assert.equal(row.account_id, "a");
  assert.equal(row.title, `${FIELD.taskTitle}:Send the offer`);
  assert.equal(row.notes, `${FIELD.taskNotes}:Signed copy`);
  assert.equal(row.list_name, `${FIELD.taskList}:Clients`);
  assert.equal(row.status, "open");
  assert.deepEqual(row.provider_meta, {});
});

test("empty notes and list names are stored as null, not sealed", async () => {
  const row = await taskRow("u", "a", input({ notes: "  ", list_name: null }), sealer);
  assert.equal(row.notes, null);
  assert.equal(row.list_name, null);
});

test("an all-day due date is midnight UTC of the date as written", async () => {
  // Local midnight in Johannesburg is the evening before in UTC; the date as written is what counts.
  assert.equal((await taskRow("u", "a", input({ due_at: "2026-10-30T00:00:00+02:00", due_all_day: true }), sealer)).due_at, "2026-10-30T00:00:00Z");
  assert.equal((await taskRow("u", "a", input({ due_at: "2026-10-30" }), sealer)).due_at, "2026-10-30T00:00:00Z");
});

test("a timed due date is kept as its instant", async () => {
  const row = await taskRow("u", "a", input({ due_at: "2026-10-30T09:30:00+02:00", due_all_day: false }), sealer);
  assert.equal(row.due_at, "2026-10-30T07:30:00.000Z");
  assert.equal(row.due_all_day, false);
  assert.equal((await taskRow("u", "a", input({ due_at: "soon", due_all_day: false }), sealer)).due_at, null);
});

test("completed_at is kept only on a completed task, and priority only when it is 1 to 3", async () => {
  const done = await taskRow("u", "a", input({ status: "completed", completed_at: "2026-10-26T08:00:00Z", priority: 1 }), sealer);
  assert.equal(done.status, "completed");
  assert.equal(done.completed_at, "2026-10-26T08:00:00Z");
  assert.equal(done.priority, 1);
  const open = await taskRow("u", "a", input({ status: "open", completed_at: "2026-10-26T08:00:00Z", priority: 9 }), sealer);
  assert.equal(open.completed_at, null);
  assert.equal(open.priority, null);
});

test("a row without contact_id leaves the matched contact alone", async () => {
  assert.equal("contact_id" in (await taskRow("u", "a", input(), sealer)), false);
  assert.equal((await taskRow("u", "a", input({ contact_id: null }), sealer)).contact_id, null);
});

test("a tick the provider took sets the task's status and completed_at", () => {
  const at = new Date("2026-10-26T08:00:00Z");
  assert.deepEqual(taskStatusPatch("complete", at), { status: "completed", completed_at: "2026-10-26T08:00:00.000Z" });
  assert.deepEqual(taskStatusPatch("reopen", at), { status: "open", completed_at: null });
});

test("only the latest queued tick for each task is made, the rest are superseded", () => {
  const rows = [
    update("2", "t1", "2026-10-26T08:00:02Z", { action: "reopen" }),
    update("1", "t1", "2026-10-26T08:00:01Z"),
    update("3", "t2", "2026-10-26T08:00:01Z"),
    update("4", "t1", "2026-10-26T08:00:03Z"),
    update("5", "t2", "2026-10-26T08:00:00Z", { status: "done" }), // settled already: left out
  ];
  const { apply, superseded } = planTaskUpdates(rows);
  assert.deepEqual(apply.map((r) => r.id).sort(), ["3", "4"]);
  assert.deepEqual(superseded.map((r) => r.id), ["1", "2"]);
});

test("ticks for an account that cannot take them fail with a reason", () => {
  assert.equal(taskAccountProblem({ provider: "google_tasks", status: "connected" }), null);
  assert.equal(taskAccountProblem({ provider: "microsoft_todo", status: "syncing" }), null);
  assert.match(taskAccountProblem({ provider: "icloud_reminders", status: "error" }) ?? "", /^iCloud Reminders needs attention/);
  assert.match(taskAccountProblem({ provider: "google_tasks", status: "disconnected" }) ?? "", /Reconnect it in Settings/);
  assert.equal(taskAccountProblem({ provider: "gmail", status: "connected" }), NOT_A_TASK_ACCOUNT);
});

test("a failure shows its own reason only when it was written for the app", () => {
  assert.equal(taskFailure(new TaskUpdateError("This task was deleted in Google Tasks."), "google_tasks"), "This task was deleted in Google Tasks.");
  assert.equal(taskFailure(new Error("ECONNRESET 10.0.0.1"), "microsoft_todo"), "Microsoft To Do could not be reached. Try again.");
  assert.equal(taskFailure("boom", "other"), "The task list could not be reached. Try again.");
});

test("failure reasons become plain code words for the analytics", () => {
  assert.equal(taskFailureCode("Ticking this task was interrupted. Reload to check whether it changed."), "interrupted");
  assert.equal(taskFailureCode("Google Tasks needs attention. Reconnect it in Settings, Connected Accounts, then try again."), "account_needs_attention");
  assert.equal(taskFailureCode(NOT_A_TASK_ACCOUNT), "not_supported");
  assert.equal(taskFailureCode("Tasks in this account cannot be ticked from here yet."), "not_supported");
  assert.equal(taskFailureCode("Microsoft To Do could not be reached. Try again."), "unreachable");
  assert.equal(taskFailureCode("This task was deleted in Google Tasks."), "provider_refused");
});

test("creates, updates and deletes are never superseded, and ticks only by later ticks", () => {
  const rows = [
    update("1", "t1", "2026-10-26T08:00:01Z"),
    update("2", "t1", "2026-10-26T08:00:02Z", { action: "update", title: "x" }),
    update("3", "t1", "2026-10-26T08:00:03Z", { action: "reopen" }),
    update("4", "t1", "2026-10-26T08:00:04Z", { action: "delete" }),
    update("5", null, "2026-10-26T08:00:02Z", { action: "create", account_id: "a1" }),
    update("6", null, "2026-10-26T08:00:03Z", { action: "create", account_id: "a1" }),
  ];
  const { apply, superseded } = planTaskUpdates(rows);
  assert.deepEqual(superseded.map((r) => r.id), ["1"]);
  assert.deepEqual(apply.map((r) => r.id), ["2", "5", "3", "6", "4"]);
});

test("a create is keyed by its own row, so two new tasks do not wait on each other", () => {
  assert.equal(taskKey({ id: "r1", task_id: "t1" }), "t1");
  assert.notEqual(taskKey({ id: "r1", task_id: null }), taskKey({ id: "r2", task_id: null }));
});

test("the state a row asks for is opened, trimmed and kept to a day when all-day", async () => {
  const opener = async (_u: string, _f: unknown, v: string | null | undefined) => (v ? v.replace(/^sealed:/, "") : null);
  const base = update("1", null, "2026-10-26T08:00:00Z", { action: "create", account_id: "a1" });
  const timed = await taskWriteOf({ ...base, title: "sealed: Call Sam ", notes: "sealed:  ", due_at: "2026-11-03T07:30:00+00:00", due_all_day: false, priority: 2 }, opener);
  assert.deepEqual(timed, { title: "Call Sam", notes: null, dueAt: "2026-11-03T07:30:00.000Z", dueAllDay: false, priority: 2 });
  const day = await taskWriteOf({ ...base, title: "sealed:A", due_at: "2026-11-03T22:00:00Z", due_all_day: true, priority: 9 }, opener);
  assert.deepEqual([day.dueAt, day.priority], ["2026-11-03T00:00:00.000Z", null]);
  assert.equal((await taskWriteOf({ ...base, title: "sealed:A", due_at: "nonsense" }, opener)).dueAt, null);
});

test("an unsupported change is worded and coded as not supported", () => {
  assert.equal(taskFailureCode(NOT_SUPPORTED_WRITE), "not_supported");
  assert.equal(taskFailureCode("This task is no longer there, so it was not changed."), "task_gone");
});
