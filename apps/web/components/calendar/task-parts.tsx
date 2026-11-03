"use client";

// Tasks on the calendar: the checkbox, chip, row and the task dialog.


import { useContext, useRef, useState } from "react";
import Link from "next/link";
import { useApp } from "@/lib/store";
import { timeOf } from "@/lib/format";
import { isOverdue, isTempTask, taskDetail, taskWhen, type DayTask } from "@/lib/tasks";
import type { Task } from "@/lib/types";
import { cn } from "@/lib/utils";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { DIALOG_BUTTONS } from "@/components/merge-dialog";

import { Detail } from "./event-details";
import { Now, Page } from "./page-context";

export const PRIORITIES: Record<number, string> = { 1: "High", 2: "Medium", 3: "Low" };

/** "Due Friday, 30 October 2026", with the time for a timed task. */
export function taskDue(task: Task) {
  if (!task.dueAt) return "No Due Date";
  const day = (task.dueAllDay ? new Date(`${task.dueAt.slice(0, 10)}T12:00:00`) : new Date(task.dueAt)).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
  return task.dueAllDay ? `Due ${day}` : `Due ${day}, ${timeOf(task.dueAt)}`;
}

export function TaskCheckbox({ task, via }: { task: Task; via: "calendar" | "details" }) {
  const { tickTask } = useApp();
  return <Checkbox checked={task.completed} onCheckedChange={(checked) => tickTask(task, checked === true, via)} disabled={isTempTask(task)} aria-label={`${task.completed ? "Mark not done" : "Mark done"}: ${task.title}`} />;
}

/** A task in the week grid: in the all-day row, or as a short item at its time. Clicking the title shows its details. */
export function TaskChip({ item, className, style }: { item: DayTask; className?: string; style?: React.CSSProperties }) {
  const { openTask, sourceOf } = useContext(Page);
  const { task, overdue } = item;
  return (
    <div
      style={style}
      title={[overdue && "Overdue", task.listName, sourceOf(task)].filter(Boolean).join(" · ") || undefined}
      className={cn("flex min-w-0 items-center gap-1.5 overflow-hidden rounded-md border bg-background px-1.5 text-xs", (task.completed || task.pending) && "opacity-60", className)}
    >
      <TaskCheckbox task={task} via="calendar" />
      <button
        type="button"
        onClick={() => openTask(task.id)}
        className={cn("min-w-0 flex-1 truncate text-left font-medium outline-none hover:underline focus-visible:underline", task.completed && "line-through", overdue && "text-destructive")}
      >
        {task.title}
      </button>
    </div>
  );
}

/** A task in the list, laid out like an event row with its checkbox where the icon goes. */
export function TaskRow({ item }: { item: DayTask }) {
  const { openTask, sourceOf } = useContext(Page);
  const { task, overdue } = item;
  return (
    <div className={cn("flex w-full items-center gap-3 rounded-lg p-3 hover:bg-muted/50", (task.completed || task.pending) && "opacity-60")}>
      <div className="flex size-8 shrink-0 items-center justify-center">
        <TaskCheckbox task={task} via="calendar" />
      </div>
      <button type="button" onClick={() => openTask(task.id)} className="flex min-w-0 flex-1 flex-col gap-1 rounded-sm text-left outline-none focus-visible:ring-2 focus-visible:ring-ring/50">
        <div className="flex h-5 w-full items-center justify-between gap-3">
          <span className={cn("min-w-0 truncate text-sm font-medium", task.completed && "line-through")}>{task.title}</span>
          <span className={cn("shrink-0 text-xs tabular-nums text-muted-foreground", overdue && !task.pending && "text-destructive")}>{taskWhen(item, timeOf)}</span>
        </div>
        <div className="flex h-4 items-center">
          <span className="min-w-0 truncate text-xs">{taskDetail(task, sourceOf(task))}</span>
        </div>
      </button>
    </div>
  );
}

/** Everything the app has about a task, with Mark as Done (or Not Done) in its button row. */
export function TaskDialog({ task, onClose, onEdit }: { task: Task | null; onClose: () => void; onEdit: (task: Task) => void }) {
  // The last task stays drawn while the dialog animates closed.
  const last = useRef<Task | null>(null);
  if (task) last.current = task;
  const shown = task ?? last.current;
  return (
    <Dialog open={!!task} onOpenChange={(open) => !open && onClose()}>
      <DialogContent track="task_details" className="max-h-[calc(100svh-2rem)] overflow-y-auto sm:max-w-lg">
        {shown && <TaskDialogBody task={shown} onClose={onClose} onEdit={onEdit} />}
      </DialogContent>
    </Dialog>
  );
}

export function TaskDialogBody({ task, onClose, onEdit }: { task: Task; onClose: () => void; onEdit: (task: Task) => void }) {
  const { sourceOf } = useContext(Page);
  const now = useContext(Now);
  const { contactById, tickTask, deleteTask } = useApp();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const saved = !isTempTask(task);
  const contact = task.contactId ? contactById(task.contactId) : undefined;
  const source = sourceOf(task);
  return (
    <>
      <DialogHeader>
        <DialogTitle className={cn("break-words", task.completed && "line-through")}>{task.title}</DialogTitle>
        <DialogDescription className="tabular-nums">{taskDue(task)}</DialogDescription>
      </DialogHeader>
      <div className="flex min-w-0 flex-col gap-4">
        {task.pending && <span className="text-sm text-muted-foreground">Saving</span>}
        <dl className="grid grid-cols-[5rem_minmax(0,1fr)] items-baseline gap-x-3 gap-y-3 text-sm">
          <Detail label="Status">{task.completed ? "Done" : isOverdue(task, now) ? <span className="text-destructive">Overdue</span> : "To Do"}</Detail>
          {task.listName && <Detail label="List">{task.listName}</Detail>}
          {source && <Detail label="Source">{source}</Detail>}
          {contact && (
            <Detail label="Contact">
              <Link href={`/contacts/${contact.id}`} className="underline-offset-2 hover:underline">{contact.name}</Link>
            </Detail>
          )}
          {task.priority && <Detail label="Priority">{PRIORITIES[task.priority]}</Detail>}
          {task.notes && (
            <Detail label="Notes">
              <span className="block max-h-40 overflow-y-auto whitespace-pre-line">{task.notes}</span>
            </Detail>
          )}
        </dl>
      </div>
      <div className={DIALOG_BUTTONS}>
        {saved && <Button variant="ghost" onClick={() => setConfirmDelete(true)}>Delete</Button>}
        {saved && <Button variant="secondary" onClick={() => onEdit(task)}>Edit</Button>}
        <Button variant="secondary" disabled={!saved} onClick={() => tickTask(task, !task.completed, "details")}>{task.completed ? "Mark as Not Done" : "Mark as Done"}</Button>
      </div>
      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent track="delete_task">
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Task?</AlertDialogTitle>
            <AlertDialogDescription>This deletes the task in {source ?? "your task list"} as well.</AlertDialogDescription>
          </AlertDialogHeader>
          <div className={DIALOG_BUTTONS}>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction variant="secondary" onClick={() => { deleteTask(task); onClose(); }}>Delete</AlertDialogAction>
          </div>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

