"use client";

// The No Date list: tasks with no due date, which have no day on the calendar. A row under the search box says how many
// there are and opens them in a dialog, so they stay in reach however far the agenda has scrolled.

import { useState } from "react";
import { ListTodo } from "lucide-react";
import type { Task } from "@/lib/types";
import { DIALOG_BUTTONS } from "@/components/merge-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { TaskRow } from "./task-parts";

/** The No Date row and its dialog. Nothing is drawn when there are no such tasks. Opening a task closes the list first. */
export function UndatedTasks({ tasks, onNewTask }: { tasks: Task[]; onNewTask: () => void }) {
  const [open, setOpen] = useState(false);
  if (tasks.length === 0) return null;
  return (
    <>
      <div className="border-b px-3 py-1">
        <Button variant="ghost" className="w-full justify-between" onClick={() => setOpen(true)}>
          <span className="flex items-center gap-2"><ListTodo className="size-4" />No Date</span>
          <Badge variant="secondary">{tasks.length}</Badge>
        </Button>
      </div>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[calc(100svh-2rem)] sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>No Date</DialogTitle>
            <DialogDescription>Tasks with no due date, from your task lists.</DialogDescription>
          </DialogHeader>
          <div className="max-h-[50svh] overflow-y-auto">
            {/* Clicking a task opens its details, so this list steps aside. */}
            <div className="flex flex-col" onClickCapture={(e) => { if ((e.target as HTMLElement).closest("button:not([role=checkbox])")) setOpen(false); }}>
              {tasks.map((task) => <TaskRow key={task.id} item={{ task, overdue: false, timed: false }} />)}
            </div>
          </div>
          <div className={DIALOG_BUTTONS}>
            <Button variant="secondary" onClick={() => { setOpen(false); onNewTask(); }}>New Task</Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
