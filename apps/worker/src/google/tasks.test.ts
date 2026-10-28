import { test } from "node:test";
import assert from "node:assert/strict";
import { GoogleApiError } from "./client";
import { GoogleAuthError } from "./oauth";
import {
  API,
  TASK_GONE,
  TASKS_API_OFF,
  allTaskLists,
  apiNotEnabled,
  dueAt,
  listTasks,
  patchBody,
  rateLimited,
  sortChanges,
  taskFields,
  taskUpdateFailure,
  writeBody,
  type GoogleTask,
} from "./tasks";

type Call = { url: string; query: Record<string, unknown> };

/** A stand-in for GoogleClient that answers each request with the next of `pages`, recording what was asked. */
function fakeClient(pages: unknown[]) {
  const calls: Call[] = [];
  return {
    calls,
    async request<T>(url: string, init: { query?: Record<string, unknown> } = {}): Promise<T> {
      calls.push({ url, query: init.query ?? {} });
      return pages.shift() as T;
    },
  };
}

test("a due date is stored as midnight UTC of that day, whatever time Google sends", () => {
  assert.equal(dueAt("2026-10-30T00:00:00.000Z"), "2026-10-30T00:00:00.000Z");
  // Google drops the time part, so a time is never kept, and the day is never shifted by a timezone.
  assert.equal(dueAt("2026-10-30T23:30:00.000Z"), "2026-10-30T00:00:00.000Z");
  assert.equal(dueAt("2026-12-31T22:00:00-05:00"), "2026-12-31T00:00:00.000Z");
  assert.equal(dueAt(undefined), null);
  assert.equal(dueAt(""), null);
  assert.equal(dueAt("not a date"), null);
});

test("a task is always due all day, and only a completed one has a completed time", () => {
  const open = taskFields({ id: "t1", title: "Send the signed offer", notes: "Ask about transfer duty", status: "needsAction", due: "2026-11-02T00:00:00.000Z", updated: "2026-10-26T08:00:00.000Z", position: "00000000000000000001" });
  assert.deepEqual(open, {
    provider_task_id: "t1",
    title: "Send the signed offer",
    notes: "Ask about transfer duty",
    due_at: "2026-11-02T00:00:00.000Z",
    due_all_day: true,
    status: "open",
    completed_at: null,
    provider_meta: { parent: null, position: "00000000000000000001", updated: "2026-10-26T08:00:00.000Z", hidden: false },
  });

  const done = taskFields({ id: "t2", title: "Book the valuation", status: "completed", completed: "2026-10-25T14:12:00.000Z", hidden: true });
  assert.equal(done.status, "completed");
  assert.equal(done.completed_at, "2026-10-25T14:12:00.000Z");
  assert.equal(done.due_at, null);
  assert.equal(done.due_all_day, true);
  assert.equal(done.provider_meta.hidden, true);

  // A stale completed time on an open task is not kept.
  assert.equal(taskFields({ id: "t3", status: "needsAction", completed: "2026-10-01T00:00:00.000Z" }).completed_at, null);
});

test("a subtask keeps its parent and position; missing fields are empty", () => {
  const sub = taskFields({ id: "t4", title: "Print the FICA documents", parent: "t1", position: "00000000000000000002" });
  assert.equal(sub.provider_meta.parent, "t1");
  assert.equal(sub.provider_meta.position, "00000000000000000002");
  const bare = taskFields({ id: "t5" });
  assert.equal(bare.title, "");
  assert.equal(bare.notes, null);
  assert.equal(bare.status, "open");
  assert.equal(bare.provider_meta.parent, null);
});

test("deleted tasks are removed and the rest kept", () => {
  const tasks: GoogleTask[] = [
    { id: "a", title: "Call the bond originator" },
    { id: "b", title: "Old task", deleted: true },
    { id: "c", title: "Cleared", status: "completed", hidden: true },
  ];
  const { keep, removed } = sortChanges(tasks);
  assert.deepEqual(keep.map((t) => t.id), ["a", "c"]);
  assert.deepEqual(removed, ["b"]);
});

test("task lists are read page by page", async () => {
  const client = fakeClient([
    { kind: "tasks#taskLists", items: [{ id: "L1", title: "My Tasks", updated: "2026-10-20T10:00:00.000Z" }], nextPageToken: "p2" },
    { kind: "tasks#taskLists", items: [{ id: "L2", title: "Clients" }] },
  ]);
  const lists = await allTaskLists(client);
  assert.deepEqual(lists.map((l) => l.id), ["L1", "L2"]);
  assert.equal(client.calls.length, 2);
  assert.equal(client.calls[0]!.url, `${API}/users/@me/lists`);
  assert.equal(client.calls[0]!.query.pageToken, undefined);
  assert.equal(client.calls[1]!.query.pageToken, "p2");
  assert.equal(client.calls[0]!.query.maxResults, 1000);
});

test("tasks are read with completed, hidden and deleted ones, since the last read, page by page", async () => {
  const client = fakeClient([
    { kind: "tasks#tasks", items: [{ id: "t1", title: "One" }, { id: "t2", title: "Two", deleted: true }], nextPageToken: "next" },
    { kind: "tasks#tasks", items: [{ id: "t3", title: "Three" }] },
    { kind: "tasks#tasks" },
  ]);
  const tasks = await listTasks(client, "MDk2NjAy/Li=", "2026-10-26T07:59:00.000Z");
  assert.deepEqual(tasks.map((t) => t.id), ["t1", "t2", "t3"]);
  const [first, second] = client.calls;
  assert.equal(first!.url, `${API}/lists/MDk2NjAy%2FLi%3D/tasks`);
  assert.deepEqual(first!.query, {
    showCompleted: true,
    showHidden: true,
    showDeleted: true,
    maxResults: 100,
    updatedMin: "2026-10-26T07:59:00.000Z",
    pageToken: undefined,
  });
  assert.equal(second!.query.pageToken, "next");

  // A full read has no updatedMin, and an empty list has no items at all.
  assert.deepEqual(await listTasks(client, "L1"), []);
  assert.equal(client.calls[2]!.query.updatedMin, undefined);
});

test("ticking off and back on send the status Google expects", () => {
  assert.deepEqual(patchBody("complete"), { status: "completed" });
  assert.deepEqual(patchBody("reopen"), { status: "needsAction", completed: null });
  assert.equal(patchBody("delete"), null);
});

test("rate limits are told apart from other refusals", () => {
  assert.equal(rateLimited(new GoogleApiError(429, null)), true);
  assert.equal(rateLimited(new GoogleApiError(403, "rateLimitExceeded")), true);
  assert.equal(rateLimited(new GoogleApiError(403, "userRateLimitExceeded")), true);
  assert.equal(rateLimited(new GoogleApiError(403, "insufficientPermissions")), false);
  assert.equal(rateLimited(new GoogleApiError(500, null)), false);
  assert.equal(rateLimited(new Error("x")), false);
  assert.equal(apiNotEnabled(new GoogleApiError(403, "accessNotConfigured")), true);
  assert.equal(apiNotEnabled(new GoogleApiError(403, "SERVICE_DISABLED")), true);
  assert.equal(apiNotEnabled(new GoogleApiError(403, "rateLimitExceeded")), false);
});

test("a failed tick says why in plain words", () => {
  assert.equal(taskUpdateFailure(new GoogleApiError(404, "notFound")), TASK_GONE);
  assert.equal(taskUpdateFailure(new GoogleApiError(429, null)), "Google Tasks is busy. Try again in a minute.");
  assert.equal(taskUpdateFailure(new GoogleApiError(403, "rateLimitExceeded")), "Google Tasks is busy. Try again in a minute.");
  assert.equal(taskUpdateFailure(new GoogleApiError(403, "accessNotConfigured")), TASKS_API_OFF);
  assert.match(taskUpdateFailure(new GoogleApiError(403, "insufficientPermissions")), /tick the Tasks box/);
  assert.match(taskUpdateFailure(new GoogleAuthError("invalid_grant")), /Reconnect Google/);
  assert.equal(taskUpdateFailure(new GoogleApiError(500, null)), "Google Tasks did not change this task. Try again.");
  for (const text of [TASK_GONE, TASKS_API_OFF, taskUpdateFailure(new Error("x"))]) assert.doesNotMatch(text, /[\u2013\u2014]/);
});

test("a task made in the app keeps only its date for Google Tasks, and a change clears what is empty", () => {
  const write = { title: "Send the offer", notes: "Signed copy", dueAt: "2026-11-03T00:00:00.000Z", dueAllDay: true, priority: 1 as const };
  assert.deepEqual(writeBody(write, true), { title: "Send the offer", notes: "Signed copy", due: "2026-11-03T00:00:00.000Z" });
  // A time is dropped: Google keeps the day.
  assert.equal(writeBody({ ...write, dueAt: "2026-11-03T13:30:00.000Z", dueAllDay: false }, true).due, "2026-11-03T00:00:00.000Z");
  const bare = { ...write, notes: null, dueAt: null };
  assert.deepEqual(writeBody(bare, true), { title: "Send the offer" });
  assert.deepEqual(writeBody(bare, false), { title: "Send the offer", notes: null, due: null });
});
