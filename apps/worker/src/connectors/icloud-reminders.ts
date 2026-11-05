// iCloud Reminders in the sync worker: only the hand-over of task changes made in the app. The account itself is
// synced by the AI worker's iCloud Reminders connector (apps/ai/ai/connectors/icloud_reminders), which signs in to
// iCloud and makes the changes this claims (store.claimed_updates there reads the rows left "updating"). So this never
// talks to iCloud and never writes the account's status: it waits for the change to be settled (tasks/settle.ts),
// failing it with a plain reason when the connector does not get to it in time. Without it the worker had no
// connector to hand Reminders changes to, and they stayed queued for ever.

import { db, must, type AccountRow } from "../db";
import type { TaskUpdateRow } from "../tasks";
import { waitUntilSettled } from "../tasks/settle";
import type { Connector } from "../runtime/state";

async function statusOf(id: string): Promise<string | null> {
  return must(await db.from("task_updates").select("status").eq("id", id).maybeSingle(), "load task update")?.status ?? null;
}

export class ICloudRemindersConnector implements Connector {
  constructor(private readonly account: AccountRow) {}

  get id() {
    return this.account.id;
  }

  start() {}

  async stop() {}

  updateTask(row: TaskUpdateRow) {
    return waitUntilSettled(() => statusOf(row.id));
  }

  createTask(row: TaskUpdateRow) {
    return waitUntilSettled(() => statusOf(row.id));
  }

  editTask(row: TaskUpdateRow) {
    return waitUntilSettled(() => statusOf(row.id));
  }

  deleteTask(row: TaskUpdateRow) {
    return waitUntilSettled(() => statusOf(row.id));
  }
}
