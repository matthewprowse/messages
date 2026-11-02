// Work the app asks for arrives through Realtime at once; a poll (2 minutes in use, 10 when quiet, and on every
// Realtime reconnect) is the safety net for a missed event. Each queue is read and handed to its dispatcher.

import type { Tables } from "@messages/db";
import type { CalendarOutboxRow } from "../calendar/create-event";
import type { CalendarDeleteRow } from "../calendar/delete-event";
import type { CalendarUpdateRow } from "../calendar/update-event";
import { db } from "../db";
import { errorCode, log } from "../log";
import { activity, markActivity, nextPollDelay, QUEUE_POLL } from "../polling";
import type { OutboxRow } from "../send/outbox";
import { isPrimaryShard } from "../shard";
import type { TaskUpdateRow } from "../tasks";
import { dispatchCalendarDeletes, dispatchCalendarOutbox, dispatchCalendarUpdates } from "./dispatch-calendar";
import { dispatchMailActions, dispatchOutbox, dispatchUnsubscribes, failStrandedOutbox, requeueStaleActions } from "./dispatch-mail";
import { dispatchOriginals, expireOriginals, fetchAttachmentRequests, type OriginalRequest } from "./dispatch-originals";
import { dispatchTaskUpdates } from "./dispatch-tasks";

const EXPIRE_ORIGINALS_MS = 5 * 60_000;

/** Work the app asks for arrives through Realtime at once, with a poll as a safety net. */
export function watchQueues() {
  const guard = (what: string, work: Promise<void>) => work.catch((err) => log.error(`${what} failed`, { code: errorCode(err) }));
  // A queued item arriving means someone is using the app: the safety-net poll and Gmail checks speed up.
  const live = (what: string, work: Promise<void>) => { markActivity(); return guard(what, work); };
  const queues = db.channel("queues")
    .on("postgres_changes", { event: "INSERT", schema: "public", table: "outbox" }, (p) => void live("outbox", dispatchOutbox([p.new as OutboxRow])))
    .on("postgres_changes", { event: "INSERT", schema: "public", table: "mail_actions" }, (p) =>
      void live("mail actions", dispatchMailActions([p.new as Tables<"mail_actions">])))
    .on("postgres_changes", { event: "INSERT", schema: "public", table: "unsubscribes" }, (p) =>
      void live("unsubscribes", dispatchUnsubscribes([p.new as Tables<"unsubscribes">])))
    .on("postgres_changes", { event: "INSERT", schema: "public", table: "calendar_outbox" }, (p) =>
      void live("calendar outbox", dispatchCalendarOutbox([p.new as CalendarOutboxRow])))
    .on("postgres_changes", { event: "INSERT", schema: "public", table: "calendar_deletes" }, (p) =>
      void live("calendar deletes", dispatchCalendarDeletes([p.new as CalendarDeleteRow])))
    .on("postgres_changes", { event: "INSERT", schema: "public", table: "calendar_updates" }, (p) =>
      void live("calendar updates", dispatchCalendarUpdates([p.new as CalendarUpdateRow])))
    .on("postgres_changes", { event: "INSERT", schema: "public", table: "task_updates" }, (p) =>
      void live("task updates", dispatchTaskUpdates([p.new as TaskUpdateRow])))
    .on("postgres_changes", { event: "INSERT", schema: "public", table: "email_originals" }, (p) =>
      void live("originals", dispatchOriginals([p.new as OriginalRequest])));
  // Opening a file that was not copied at once asks for it here: its own channel, so that a missing publication
  // (the migration not applied yet) only fails this one, and the safety-net poll still finds the request.
  db.channel("attachment-requests")
    .on("postgres_changes", { event: "INSERT", schema: "public", table: "attachment_fetch_requests" }, () => void live("attachment requests", fetchAttachmentRequests()))
    .subscribe();
  // A safety net for a missed Realtime event (queued work normally arrives at once): every 2 minutes while the
  // app is in use, every 10 minutes when quiet. A queued item snaps it back. The real gap is a Realtime
  // reconnect, so the queues are also read once each time the channel (re)subscribes.
  let lastExpire = 0;
  const poll = () => {
    void guard("outbox", dispatchOutbox());
    void guard("stranded outbox", failStrandedOutbox());
    void guard("mail actions", requeueStaleActions().then(() => dispatchMailActions()));
    void guard("unsubscribes", dispatchUnsubscribes());
    void guard("calendar outbox", dispatchCalendarOutbox());
    void guard("calendar deletes", dispatchCalendarDeletes());
    void guard("calendar updates", dispatchCalendarUpdates());
    void guard("task updates", dispatchTaskUpdates());
    void guard("originals", dispatchOriginals());
    void guard("attachment requests", fetchAttachmentRequests());
    if (isPrimaryShard && Date.now() - lastExpire >= EXPIRE_ORIGINALS_MS) {
      lastExpire = Date.now();
      void guard("expire originals", expireOriginals());
    }
  };
  queues.subscribe((status) => {
    if (status === "SUBSCRIBED") poll();
  });
  let timer: ReturnType<typeof setTimeout>;
  let scheduledMs = 0;
  const schedule = () => {
    scheduledMs = nextPollDelay(Date.now(), activity.since(), QUEUE_POLL);
    timer = setTimeout(() => { poll(); schedule(); }, scheduledMs);
    timer.unref();
  };
  activity.onMark(() => {
    // Moved from a long wait to a short one: restart the timer so the shorter delay applies now.
    if (nextPollDelay(Date.now(), activity.since(), QUEUE_POLL) < scheduledMs) {
      clearTimeout(timer);
      schedule();
    }
  });
  poll();
  schedule();
}
