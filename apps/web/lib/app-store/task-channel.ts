// The Realtime channel for tasks the worker stores or changes. It is separate from the inbox channel so the inbox keeps
// working if the tasks table is not published for Realtime. Started by use-realtime.ts, which owns the batch queue and
// the stop flag passed in here.

import type { Tables } from "@messages/db";
import { loadTasks } from "../data";
import { openTasks } from "../open-rows";
import { supabase } from "../supabase";
import { mapTask } from "../tasks";
import type { Action, State } from "./reducer";

export interface TaskChannelDeps {
  userId: string;
  stateRef: React.MutableRefObject<State>;
  rawDispatch: React.Dispatch<Action>;
  /** Adds a change to the realtime hook's next batch, at a rank (see queued in use-realtime.ts). */
  queued: (key: string, rank: number, run: () => Promise<void> | void) => void;
  /** True once the realtime hook has been torn down. */
  stopped: () => boolean;
}

/** Subscribes to the user's tasks and returns the channel, which the caller removes when it stops. */
export function subscribeTasks({ userId, stateRef, rawDispatch, queued, stopped }: TaskChannelDeps) {
  let taskDropped = false, taskJoined = false, taskErrors = 0;
  /** The tasks again, applied on top of the ones held (a task made here and not yet stored stays). */
  async function refreshTasks() {
    const base = stateRef.current.tasks;
    try {
      const tasks = await loadTasks();
      if (!stopped()) rawDispatch({ type: "tasksLoaded", base, tasks });
    } catch {
      // the next reconnect tries again
    }
  }
  // A resync of the inbox reloads tasks too; this channel only covers changes while it is joined.
  const taskChannel = supabase
    .channel(`tasks-${userId}`)
    .on("postgres_changes", { event: "DELETE", schema: "public", table: "tasks" }, (payload) => {
      const id = (payload.old as { id?: string } | null)?.id;
      if (id && stateRef.current.tasks.some((t) => t.id === id)) rawDispatch({ type: "removeTask", id });
    })
    .on("postgres_changes", { event: "*", schema: "public", table: "tasks", filter: `user_id=eq.${userId}` }, (payload) => {
      if (payload.eventType === "DELETE") return;
      const changed = payload.new as Tables<"tasks">;
      queued(`task:${changed.id}`, 3, async () => {
        const [row] = await openTasks([{ ...changed }]);
        rawDispatch({ type: "upsertTask", task: mapTask(row) });
      });
    })
    .subscribe((status) => {
      if (status === "SUBSCRIBED") {
        // Tasks changed while the channel was down (or before it first joined) were never announced: read them again.
        if (taskDropped) void refreshTasks();
        taskDropped = false;
        taskJoined = true;
        taskErrors = 0;
      } else {
        taskDropped = true; // the client rejoins by itself
        // A table that is not published for Realtime never joins: after a few tries it is given up on. One that joined before keeps rejoining.
        if (status === "CHANNEL_ERROR" && !taskJoined && ++taskErrors >= 3) void supabase.removeChannel(taskChannel);
      }
    });
  return taskChannel;
}
