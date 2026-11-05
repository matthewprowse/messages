// The New Task dialog (new-task-dialog.tsx): Create hands the store's createTask the form, editing hands editTask the
// change, and it refuses a task with no title or a time with no date. Google Tasks keeps only a date.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mock } from "node:test";
import { screen } from "@testing-library/react";
import { dayKey } from "@/lib/dates";
import type { Account } from "@/lib/types";
import { NewTaskDialog } from "./new-task-dialog";
import { argsOf } from "@/test/fake-store";
import { renderScreen } from "@/test/render";
import { TASKS_ACCOUNT } from "@/test/calendar-fixtures";
import { task } from "@/test/fixtures";

function renderTask(accounts: Account[] = [TASKS_ACCOUNT], editing?: ReturnType<typeof task>) {
  const onOpenChange = mock.fn((_open: boolean) => undefined);
  const s = renderScreen(<NewTaskDialog open onOpenChange={onOpenChange} editing={editing} />, { accounts });
  return { ...s, onOpenChange };
}

test("Create hands the store the title and notes, due today in the first task list, and closes", async () => {
  const { user, store, onOpenChange } = renderTask();
  assert.ok(screen.getByRole("dialog", { name: "New Task" }));
  await user.click(screen.getByLabelText("Title")); await user.paste("Send the revised quote");
  await user.click(screen.getByLabelText("Notes")); await user.paste("Oak worktops as a separate line");
  await user.click(screen.getByRole("button", { name: "Create" }));
  const [form] = argsOf(store.createTask)[0];
  assert.deepEqual(form, { title: "Send the revised quote", notes: "Oak worktops as a separate line", accountId: TASKS_ACCOUNT.id, date: dayKey(new Date()), time: "", priority: 0 });
  assert.deepEqual(onOpenChange.mock.calls[0].arguments, [false]);
});

test("Create with no title asks for one and makes nothing", async () => {
  const { user, store, onOpenChange } = renderTask();
  await user.click(screen.getByRole("button", { name: "Create" }));
  assert.ok(screen.getByText("Enter a title."));
  assert.equal(store.createTask.mock.callCount(), 0);
  assert.equal(onOpenChange.mock.callCount(), 0);
});

test("No Date clears the due date, and the task is made without one", async () => {
  const { user, store } = renderTask();
  await user.click(screen.getByLabelText("Title")); await user.paste("Call the landlord");
  await user.click(screen.getByRole("button", { name: "No Date" }));
  assert.match(screen.getByRole("button", { name: /^Due Date/ }).textContent ?? "", /No Date/);
  await user.click(screen.getByRole("button", { name: "Create" }));
  assert.equal((argsOf(store.createTask)[0][0] as { date: string }).date, "");
});

test("with no task list connected it says how to connect one", () => {
  renderTask([]);
  assert.ok(screen.getByText("Connect a Task List to Add Tasks"));
  assert.equal(screen.queryByLabelText("Title"), null);
});

test("Google Tasks keeps only the date, so there is no time or priority to set", () => {
  renderTask([{ ...TASKS_ACCOUNT, id: "account-google-tasks", provider: "google_tasks" }]);
  assert.ok(screen.getByText("Google Tasks keeps only the date."));
  assert.equal(screen.queryByLabelText("Time"), null);
  assert.equal(screen.queryByLabelText("Priority"), null);
});

test("editing opens with the task, Save stays off until something changes, then hands editTask the change", async () => {
  const existing = task("task-1", "Book the assessor", { accountId: TASKS_ACCOUNT.id, notes: "" });
  const { user, store } = renderTask([TASKS_ACCOUNT], existing);
  assert.ok(screen.getByRole("dialog", { name: "Edit Task" }));
  assert.equal((screen.getByLabelText("Title") as HTMLInputElement).value, "Book the assessor");
  const save = screen.getByRole("button", { name: "Save" }) as HTMLButtonElement;
  assert.equal(save.disabled, true);
  await user.click(screen.getByLabelText("Title")); await user.paste(" for Monday");
  await user.click(save);
  const [sent, form] = argsOf(store.editTask)[0];
  assert.equal(sent, existing);
  assert.equal((form as { title: string }).title, "Book the assessor for Monday");
  assert.equal(store.createTask.mock.callCount(), 0);
});
