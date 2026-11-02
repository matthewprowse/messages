// Task changes made in the app (ticked, made, edited, deleted), handed to the task account's connector one task at a
// time, oldest first. The contract for what several queued changes to one task mean is in tasks/index.ts.

import { errorCode, log } from "../log";
import { ORPHAN_GRACE_MS } from "../recovery-plan";
import { isPrimaryShard, ownsAccount } from "../shard";
import {
  NOT_SUPPORTED_TICK, NOT_SUPPORTED_WRITE, TASK_GONE, accountsById, accountsOfTasks, claimTaskUpdate, failTaskUpdates, finishTaskUpdate, planTaskUpdates, queuedTaskUpdates,
  isTaskWriteAction, queuedTaskUpdateById, queuedTaskUpdatesFor, supersedeTaskUpdates, taskAccountProblem, taskFailure, taskKey, usersWithReminders, type TaskUpdateRow,
} from "../tasks";
import { dispatchOnce, running, type Connector } from "./state";

/** The connector's handler for a queued task change, or undefined when it has none. */
export function taskHandler(connector: Connector, action: string): ((row: TaskUpdateRow) => Promise<void>) | undefined {
  const handler = action === "create" ? connector.createTask : action === "update" ? connector.editTask : action === "delete" ? connector.deleteTask : connector.updateTask;
  return handler?.bind(connector);
}

/**
 * Tasks ticked, made, changed and deleted in the app, one task at a time, oldest first: of several ticks for a
 * task the latest is made and the earlier are superseded, while creates, updates and deletes are all made
 * (tasks/index.ts has the contract). The queue is read again for each task once its lock is held, so a change
 * that arrived through Realtime cannot overtake an older one waiting in the poll.
 */
export async function dispatchTaskUpdates(rows?: TaskUpdateRow[]) {
  const list = rows ?? (await queuedTaskUpdates());
  // A change to a task that is gone (its row removed, which clears task_id) has nothing left to change.
  // Left alone for a user with iCloud Reminders: the AI worker's connector settles such rows for its own user.
  // Nobody owns such a row, so only the primary shard settles it, and only once it has had time to be a real orphan.
  const orphans = list.filter((r) => r.status === "queued" && !r.task_id && r.action !== "create");
  if (isPrimaryShard) {
    const reminders = await usersWithReminders([...new Set(orphans.map((r) => r.user_id))]);
    const gone = orphans.filter((r) => !reminders.has(r.user_id) && Date.now() - Date.parse(r.created_at) >= ORPHAN_GRACE_MS);
    await failTaskUpdates(gone, TASK_GONE);
  }
  const { apply } = planTaskUpdates(list.filter((r) => !orphans.includes(r)));
  const first = new Map<string, TaskUpdateRow>();
  for (const row of apply) if (!first.has(taskKey(row))) first.set(taskKey(row), row);
  const taskAccounts = await accountsOfTasks([...first.values()].flatMap((r) => (r.task_id ? [r.task_id] : [])));
  const newAccounts = await accountsById([...first.values()].flatMap((r) => (!r.task_id && r.account_id ? [r.account_id] : [])));
  for (const [key, sample] of first) {
    await dispatchOnce(
      `task:${key}`,
      async () => {
        const account = sample.task_id ? taskAccounts.get(sample.task_id) : sample.account_id ? newAccounts.get(sample.account_id) : undefined;
        if (!account || !ownsAccount(account.id)) return null; // the task is gone (its ticks wait for shard 0), or another shard owns it
        const queue = sample.task_id ? await queuedTaskUpdatesFor(sample.task_id) : await queuedTaskUpdateById(sample.id);
        const problem = taskAccountProblem(account);
        if (problem) {
          await failTaskUpdates(queue, problem, account.provider);
          return null;
        }
        const connector = running.get(account.id)?.connector;
        if (!connector) return null; // starting up: picked up on the next pass
        const unsupported = queue.filter((r) => !taskHandler(connector, r.action));
        await failTaskUpdates(unsupported, unsupported.some((r) => isTaskWriteAction(r.action)) ? NOT_SUPPORTED_WRITE : NOT_SUPPORTED_TICK, account.provider);
        const { apply: [row], superseded } = planTaskUpdates(queue.filter((r) => !unsupported.includes(r)));
        if (!row) return null;
        const handle = taskHandler(connector, row.action)!;
        await supersedeTaskUpdates(superseded);
        if (!(await claimTaskUpdate(row.id))) return null;
        return async () => {
          try {
            await handle(row);
            await finishTaskUpdate(row, {}, account.provider);
          } catch (err) {
            log.warn("task update failed", { update: row.id, code: errorCode(err) });
            await finishTaskUpdate(row, { error: taskFailure(err, account.provider) }, account.provider);
          } finally {
            // A change made while this one was under way waits for the lock: it goes next, not at the next poll.
            if (row.task_id) setTimeout(() => void dispatchTaskUpdatesFor(row.task_id!), 0);
          }
        };
      },
      (err) => log.error("task update failed", { task: key, code: errorCode(err) }),
    );
  }
}

async function dispatchTaskUpdatesFor(taskId: string) {
  try {
    const queue = await queuedTaskUpdatesFor(taskId);
    if (queue.length) await dispatchTaskUpdates(queue);
  } catch (err) {
    log.error("task updates failed", { code: errorCode(err) });
  }
}
