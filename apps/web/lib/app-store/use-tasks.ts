// Tasks: ticking, creating, editing and deleting go through the task_updates queue to the worker, shown at once and
// put back on failure. Pending ticks are laid over the stored tasks until each settles.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { FIELD } from "@messages/crypto/fields";
import { supabase } from "../supabase";
import { isOverdue, isTempTask, taskOfWrite, taskWriteFields, tempTaskId, withTicks, type PendingTick, type TaskForm } from "../tasks";
import { seal } from "../vault";
import { track } from "../analytics";
import type { Task } from "../types";
import { followTaskUpdate } from "./task-follow";
import type { Action, State } from "./reducer";

export interface TaskDeps {
  userId: string | null;
  stored: Task[];
  rawDispatch: React.Dispatch<Action>;
  stateRef: React.MutableRefObject<State>;
  saveFailed: () => void;
}

/** The task actions of the context, and the tasks with pending ticks applied. */
export function useTasks({ userId, stored, rawDispatch, stateRef, saveFailed }: TaskDeps) {
  // Ticks waiting on the worker, by task, laid over the tasks until each settles.
  const [ticks, setTicks] = useState<Record<string, PendingTick | undefined>>({});
  const ticksRef = useRef(ticks);
  ticksRef.current = ticks;
  const tasks = useMemo(() => withTicks(stored, ticks), [stored, ticks]);
  useEffect(() => { setTicks({}); }, [userId]);

  const tickTask = useCallback((task: Task, done: boolean, via: "calendar" | "details" | "summary") => {
    if (!userId) return;
    const action = done ? "complete" : "reopen";
    const provider = stateRef.current.accounts.find((a) => a.id === task.accountId)?.provider ?? "unknown";
    track("task_ticked", { action, provider, overdue: isOverdue(task), timed: !!task.dueAt && !task.dueAllDay, via });
    const temp = `tick-${crypto.randomUUID()}`;
    setTicks((t) => ({ ...t, [task.id]: { token: temp, done } }));
    // A tick is dropped by its own result only while it is the latest for its task, so an earlier one settling leaves the newer showing.
    const drop = (token: string) => setTicks((t) => (t[task.id]?.token === token ? { ...t, [task.id]: undefined } : t));
    void (async () => {
      const { data, error } = await supabase.from("task_updates").insert({ task_id: task.id, action }).select("id").single();
      if (error || !data) {
        drop(temp);
        saveFailed();
        return;
      }
      setTicks((t) => (t[task.id]?.token === temp ? { ...t, [task.id]: { token: data.id, done } } : t));
      const result = await followTaskUpdate(data.id);
      // The task as the worker left it, in case its own Realtime update is slow or missed.
      if (result.status === "done" && ticksRef.current[task.id]?.token === data.id) {
        rawDispatch({ type: "patchTask", id: task.id, patch: { completed: done, completedAt: done ? new Date().toISOString() : undefined } });
      }
      if (result.status === "failed") toast(result.error ?? (done ? "The task could not be ticked off." : "The task could not be reopened."));
      drop(data.id);
    })();
  }, [userId, saveFailed]);

  // Tasks made, changed and deleted here go through the same queue as a tick. Title and notes are sealed before the row is stored.
  const queueTaskWrite = useCallback(async (row: { action: "create" | "update" | "delete"; task_id?: string; account_id?: string }, write?: ReturnType<typeof taskWriteFields>) => {
    const sealed = write ? await Promise.all([seal(FIELD.taskTitle, write.title), seal(FIELD.taskNotes, write.notes)]).catch(() => null) : undefined;
    if (write && !sealed) return null;
    const { data, error } = await supabase
      .from("task_updates")
      .insert({ ...row, ...(write && sealed ? { title: sealed[0], notes: sealed[1], due_at: write.due_at, due_all_day: write.due_all_day, priority: write.priority } : {}) })
      .select("id")
      .single();
    return error || !data ? null : data.id;
  }, []);

  const createTask = useCallback((form: TaskForm) => {
    if (!userId) return;
    const provider = stateRef.current.accounts.find((a) => a.id === form.accountId)?.provider;
    const write = taskWriteFields(form, provider);
    const temp = tempTaskId();
    rawDispatch({ type: "upsertTask", task: taskOfWrite(temp, form.accountId, write) });
    void (async () => {
      const id = await queueTaskWrite({ action: "create", account_id: form.accountId }, write);
      if (!id) {
        rawDispatch({ type: "removeTask", id: temp });
        saveFailed();
        return;
      }
      const result = await followTaskUpdate(id, 60_000, 2000, "Creating the task is taking too long. Check that the worker is running.");
      // The worker has stored the real task by now (its Realtime insert replaces this one); on failure it never will.
      rawDispatch({ type: "removeTask", id: temp });
      toast(result.status === "failed" ? (result.error ?? "The task could not be created.") : "Task created.");
    })();
  }, [userId, saveFailed, queueTaskWrite]);

  const editTask = useCallback((task: Task, form: TaskForm) => {
    if (!userId || isTempTask(task)) return;
    const provider = stateRef.current.accounts.find((a) => a.id === task.accountId)?.provider;
    const write = taskWriteFields({ ...form, accountId: task.accountId }, provider);
    rawDispatch({ type: "upsertTask", task: taskOfWrite(task.id, task.accountId, write, task) });
    // Put back as it was, unless something newer has been shown for the task since.
    const restore = () => rawDispatch({ type: "upsertTask", task });
    void (async () => {
      const id = await queueTaskWrite({ action: "update", task_id: task.id }, write);
      if (!id) {
        restore();
        saveFailed();
        return;
      }
      const result = await followTaskUpdate(id, 60_000, 2000, "Saving the task is taking too long. Check that the worker is running.");
      if (result.status === "failed") {
        restore();
        toast(result.error ?? "The task could not be changed.");
        return;
      }
      rawDispatch({ type: "patchTask", id: task.id, patch: { pending: false } });
    })();
  }, [userId, saveFailed, queueTaskWrite]);

  const deleteTask = useCallback((task: Task) => {
    if (!userId || isTempTask(task)) return;
    rawDispatch({ type: "removeTask", id: task.id });
    void (async () => {
      const id = await queueTaskWrite({ action: "delete", task_id: task.id });
      if (!id) {
        rawDispatch({ type: "upsertTask", task });
        saveFailed();
        return;
      }
      const result = await followTaskUpdate(id, 60_000, 2000, "Deleting the task is taking too long. Check that the worker is running.");
      if (result.status === "failed") {
        rawDispatch({ type: "upsertTask", task });
        toast(result.error ?? "The task could not be deleted.");
        return;
      }
      toast("Task deleted.");
    })();
  }, [userId, saveFailed, queueTaskWrite]);

  return { tasks, tickTask, createTask, editTask, deleteTask };
}
