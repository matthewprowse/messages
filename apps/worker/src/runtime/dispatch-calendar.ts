// Queued calendar work made in the app: new events, deletes, and changes or invitation answers, handed to the calendar
// account's connector. One that cannot take them fails with a reason (./calendar-problem.ts).

import { db } from "../db";
import { readByIds, readQueued } from "../in-chunks";
import { errorCode, log } from "../log";
import { ownsAccount } from "../shard";
import type { CalendarOutboxRow } from "../calendar/create-event";
import { failDelete, queuedDeletes, type CalendarDeleteRow } from "../calendar/delete-event";
import { failUpdate, queuedUpdates } from "../calendar/update-queue";
import type { CalendarUpdateRow } from "../calendar/update-event";
import { failEvent } from "../connectors/google-calendar";
import { calendarAccountProblem, type CalendarAccount } from "./calendar-problem";
import { dispatchOnce, running, runningIds, type Connector } from "./state";

/** The accounts named by queued calendar rows, in one read. */
async function calendarAccounts(rows: { account_id: string }[]): Promise<Map<string, CalendarAccount>> {
  const ids = [...new Set(rows.map((row) => row.account_id))];
  if (ids.length === 0) return new Map();
  const accounts = await readByIds(ids, (slice) => db.from("accounts").select("id, provider, status").in("id", slice), "load calendar accounts");
  return new Map(accounts.map((account) => [account.id, account]));
}


type CalendarTable = "calendar_outbox" | "calendar_deletes" | "calendar_updates";

/**
 * Safety net for calendar work that threw after its row was claimed: a row still in flight is failed (only while it is, so
 * one the connector settled or put back is left alone, and a row that failed to prepare stays queued). The wording admits
 * the change may have been made. Never throws.
 */
async function failStuckCalendar(table: CalendarTable, status: string, id: string) {
  try {
    await (db as unknown as { from(t: string): { update(v: object): { eq(c: string, v: string): { eq(c: string, v: string): PromiseLike<unknown> } } } })
      .from(table)
      .update({ status: "failed", error: "This change may not have been made. Reload to check, then try again.", done_at: new Date().toISOString() })
      .eq("id", id)
      .eq("status", status);
  } catch (err) {
    log.error("could not fail stuck calendar row", { code: errorCode(err) });
  }
}

/**
 * Hands queued calendar rows (new events, deletes or changes) to their calendar account's connector. Ones for an account that cannot take them fail with a reason.
 */
async function dispatchCalendar<Row extends { id: string; status: string; account_id: string }>(
  list: Row[],
  verb: "added to" | "deleted from" | "changed in",
  fail: (id: string, reason: string) => Promise<void>,
  pick: (connector: Connector) => ((row: Row) => Promise<void>) | undefined,
  what: string,
  inFlight: { table: CalendarTable; status: string },
) {
  const queued = list.filter((row) => row.status === "queued");
  const accounts = await calendarAccounts(queued);
  for (const row of queued) {
    await dispatchOnce(
      row.id,
      async () => {
        const account = accounts.get(row.account_id);
        if (!account || !ownsAccount(account.id)) return null; // another shard's account is left queued for it
        const problem = calendarAccountProblem(account, verb);
        if (problem) {
          await fail(row.id, problem);
          return null;
        }
        const connector = running.get(account.id)?.connector;
        const handle = connector && pick(connector);
        if (!handle) return null; // starting up: picked up on the next pass
        return () => handle(row);
      },
      (err) => {
        log.error(`${what} failed`, { event: row.id, code: errorCode(err) });
        void failStuckCalendar(inFlight.table, inFlight.status, row.id);
      },
    );
  }
}

/** Events made in the app. */
export async function dispatchCalendarOutbox(rows?: CalendarOutboxRow[]) {
  const list = rows ?? (runningIds().length ? await readQueued(runningIds(), (slice) => db.from("calendar_outbox").select("*").eq("status", "queued").in("account_id", slice).order("created_at").limit(50), "load calendar outbox", 50) : []);
  await dispatchCalendar(list, "added to", failEvent, (c) => c.createEvent?.bind(c), "calendar event", { table: "calendar_outbox", status: "creating" });
}

/** Events the app asked to delete. */
export async function dispatchCalendarDeletes(rows?: CalendarDeleteRow[]) {
  await dispatchCalendar(rows ?? (await queuedDeletes(runningIds())), "deleted from", failDelete, (c) => c.deleteEvent?.bind(c), "calendar delete", { table: "calendar_deletes", status: "deleting" });
}

/** Changes to events, and answers to invitations, made in the app. */
export async function dispatchCalendarUpdates(rows?: CalendarUpdateRow[]) {
  await dispatchCalendar(rows ?? (await queuedUpdates(runningIds())), "changed in", failUpdate, (c) => c.updateEvent?.bind(c), "calendar update", { table: "calendar_updates", status: "updating" });
}
