// What the worker's runtime shares: the connector contract, the running connectors, and the one-at-a-time hand-off of a
// queued row. Every runtime module (reconcile, the queue dispatchers, shutdown) imports from here, so nothing else
// holds state. Keeps no database import, so the hand-off can be tested without a configured worker.

import type { Json, Tables } from "@messages/db";
import type { CalendarOutboxRow } from "../calendar/create-event";
import type { CalendarDeleteRow } from "../calendar/delete-event";
import type { CalendarUpdateRow } from "../calendar/update-event";
import type { EmailAttachment } from "../ingest/normalize-email";
import { errorCode, log } from "../log";
import type { OutboxRow } from "../send/outbox";
import type { TaskUpdateRow } from "../tasks";

/** What every connector does. Mail connectors also send replies, apply app actions and unsubscribe. */
export interface Connector {
  start(): void;
  stop(): Promise<void>;
  send?(row: OutboxRow): Promise<void>;
  applyAction?(row: Tables<"mail_actions">): Promise<void>;
  unsubscribe?(row: Tables<"unsubscribes">): Promise<void>;
  /** Google Calendar and iCloud Calendar: creates an event queued in the app. */
  createEvent?(row: CalendarOutboxRow): Promise<void>;
  /** Google Calendar and iCloud Calendar: deletes an event, or an occurrence of one, queued in the app. */
  deleteEvent?(row: CalendarDeleteRow): Promise<void>;
  /** Google Calendar, iCloud Calendar and Outlook Calendar: changes an event, or answers an invitation, queued in the app. */
  updateEvent?(row: CalendarUpdateRow): Promise<void>;
  /** Microsoft To Do, Google Tasks and iCloud Reminders: ticks a task off or on at the provider (see tasks/index.ts). */
  updateTask?(row: TaskUpdateRow): Promise<void>;
  /** The same three, for tasks made, changed and deleted in the app. */
  createTask?(row: TaskUpdateRow): Promise<void>;
  editTask?(row: TaskUpdateRow): Promise<void>;
  deleteTask?(row: TaskUpdateRow): Promise<void>;
  /** Email only: the email as sent (its HTML), fetched for View Original. "missing" when it is gone. */
  original?(meta: Json): Promise<string | null | "missing">;
  /** Email only: one message's attachments, fetched again from the mailbox for a file that was not copied at once. Null when it is gone. */
  attachmentsOf?(meta: Json): Promise<EmailAttachment[] | null>;
}

export interface Running {
  connector: Connector;
  credentialsUpdatedAt: string;
}

export const running = new Map<string, Running>();

/** Stops a connector. A failure is logged and leaves it in place, so the next pass tries again. */
export async function stopConnector(accountId: string, entry: Running): Promise<boolean> {
  try {
    await entry.connector.stop();
    return true;
  } catch (err) {
    log.warn("connector stop failed", { account: accountId, code: errorCode(err) });
    return false;
  }
}

export const dispatching = new Set<string>();

/**
 * Hands one queued row to its connector, at most once at a time. The id is held from before the first
 * await, so the Realtime and poll paths cannot both hand on the same row. `prepare` returns the work to
 * start, or null to leave the row for a later pass.
 */
export async function dispatchOnce(id: string, prepare: () => Promise<(() => Promise<void>) | null>, onError: (err: unknown) => void) {
  if (dispatching.has(id)) return;
  dispatching.add(id);
  let work: (() => Promise<void>) | null = null;
  try {
    work = await prepare();
  } catch (err) {
    // One row that fails to prepare must not abort the rest of the batch.
    onError(err);
  } finally {
    if (!work) dispatching.delete(id);
  }
  if (!work) return;
  work()
    .catch(onError)
    .finally(() => dispatching.delete(id));
}

/** The accounts this worker runs: queue polls read only their rows, so rows it ignores cannot fill the window. */
export const runningIds = () => [...running.keys()];
