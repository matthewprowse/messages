"use client";

// The No Date view: tasks with no due date, which have no day on the calendar, listed in the list column in place of
// the agenda. The grid beside it stays as it was.

import { ListTodo } from "lucide-react";
import type { Task } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { EmptyState } from "@/components/primitives";
import { Separated } from "@/components/surface";
import { TaskRow } from "./task-parts";

export function UndatedTasks({ tasks, onNewTask }: { tasks: Task[]; onNewTask: () => void }) {
  return (
    <ScrollArea className="h-full">
      <div className="p-3">
        {tasks.length === 0 ? (
          <div className="py-24">
            <EmptyState icon={ListTodo} title="No Tasks Without a Date" action={<Button variant="secondary" onClick={onNewTask}>New Task</Button>} />
          </div>
        ) : (
          <Separated>
            {tasks.map((task) => <TaskRow key={task.id} item={{ task, overdue: false, timed: false }} />)}
          </Separated>
        )}
      </div>
    </ScrollArea>
  );
}
