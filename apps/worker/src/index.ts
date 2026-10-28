import { db, must } from "./db";
import { log, errorCode } from "./log";
import { ICloudConnector } from "./connectors/icloud";
import { ImapConnector } from "./connectors/imap";
import { IMAP_SERVICE } from "./connectors/mail-service";
import { GmailConnector } from "./connectors/gmail";
import { GoogleCalendarConnector, failEvent, failInterruptedEvents, queuedEvents } from "./connectors/google-calendar";
import type { CalendarOutboxRow } from "./calendar/create-event";
import { failDelete, failInterruptedDeletes, queuedDeletes, type CalendarDeleteRow } from "./calendar/delete-event";
import { failInterruptedUpdates, failUpdate, queuedUpdates } from "./calendar/update-queue";
import type { CalendarUpdateRow } from "./calendar/update-event";
import { WhatsAppConnector } from "./connectors/whatsapp";
import { OutlookConnector } from "./connectors/outlook";
import { OutlookCalendarConnector } from "./connectors/outlook-calendar";
import { ICloudCalendarConnector } from "./connectors/icloud-calendar";
import { GoogleTasksConnector } from "./connectors/google-tasks";
import { MicrosoftTodoConnector } from "./connectors/microsoft-todo";
import { TeamsConnector } from "./connectors/teams";
import { ICloudRemindersConnector, relayAccount } from "./connectors/icloud-reminders";
import { startRelayServer } from "./reminders/server";
import { env } from "./env";
import { GoogleMeetConnector } from "./connectors/google-meet";
import { ZoomConnector } from "./connectors/zoom";
import { LinkedInConnector } from "./connectors/linkedin";
import { startPhotoSync } from "./photos/job";
import { startCompanyLogos } from "./logos/job";
import { startContactLinker } from "./contacts/linker";
import { startAddressIndexer } from "./address-indexer";
import { startMeetingLinker } from "./meetings/linker";
import { startShareJobs } from "./share/job";
import { startTeamKeyRotation } from "./share/rotate";
import { startTeamRules } from "./share/team-store";
import type { AccountRow } from "./db";
import { activity, markActivity, nextPollDelay, QUEUE_POLL } from "./polling";
import { startUsageRollup } from "./usage-rollup";
import type { Json, Tables } from "@messages/db";
import { FIELD } from "@messages/crypto/fields";
import { openAddressRows, seal } from "./vault";
import { failInterrupted, type OutboxRow } from "./send/outbox";
import { startOutboxCleanup, withAttachmentSlot } from "./send/outbox-attachments";
import {
  NOT_SUPPORTED_TICK, NOT_SUPPORTED_WRITE, TASK_GONE, accountsById, accountsOfTasks, claimTaskUpdate, failInterruptedTaskUpdates, failTaskUpdates, finishTaskUpdate, planTaskUpdates, queuedTaskUpdates,
  isTaskWriteAction, queuedTaskUpdateById, queuedTaskUpdatesFor, supersedeTaskUpdates, taskAccountProblem, taskFailure, taskKey, usersWithReminders, type TaskUpdateRow,
} from "./tasks";

// The always-on sync worker. Every 30 seconds it reconciles running connectors with the accounts table:
// new accounts start, disconnected ones stop, and accounts with fresh credentials restart. Work queued
// in the app (replies and new emails, mail actions, unsubscribes, calendar events, ticked tasks) arrives through
// Realtime and a poll, and is handed to the account's connector. Alongside run photo sync, the contact
// linker, and a daily cleanup of files sent with old outbox rows.

const RECONCILE_MS = 30_000;
const ACCOUNT_SETTLE_MS = 1500;
const EXPIRE_ORIGINALS_MS = 5 * 60_000;
const USAGE_ROLLUP_MS = 24 * 60 * 60_000;
const SHUTDOWN_MS = 10_000;

/** What every connector does. Mail connectors also send replies, apply app actions and unsubscribe. */
interface Connector {
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
}

const CONNECTORS: Record<string, (account: AccountRow) => Connector> = {
  icloud: (account) => new ICloudConnector(account),
  imap: (account) => new ImapConnector(account, IMAP_SERVICE),
  gmail: (account) => new GmailConnector(account),
  google_calendar: (account) => new GoogleCalendarConnector(account),
  whatsapp: (account) => new WhatsAppConnector(account),
  outlook: (account) => new OutlookConnector(account),
  outlook_calendar: (account) => new OutlookCalendarConnector(account),
  icloud_calendar: (account) => new ICloudCalendarConnector(account),
  google_tasks: (account) => new GoogleTasksConnector(account),
  microsoft_todo: (account) => new MicrosoftTodoConnector(account),
  teams: (account) => new TeamsConnector(account),
  icloud_reminders: (account) => new ICloudRemindersConnector(account),
  google_meet: (account) => new GoogleMeetConnector(account),
  zoom: (account) => new ZoomConnector(account),
  linkedin: (account) => new LinkedInConnector(account),
};

interface Running {
  connector: Connector;
  credentialsUpdatedAt: string;
}

const running = new Map<string, Running>();

/** Stops a connector. A failure is logged and leaves it in place, so the next pass tries again. */
async function stopConnector(accountId: string, entry: Running): Promise<boolean> {
  try {
    await entry.connector.stop();
    return true;
  } catch (err) {
    log.warn("connector stop failed", { account: accountId, code: errorCode(err) });
    return false;
  }
}

let reconciling = false;
let again = false;

/** One pass at a time: a slow stop() must not let the next tick start a second connector for an account.
 *  A call during a pass runs one more pass after it, so a change that lands mid-pass is not missed. */
async function reconcile() {
  if (reconciling) { again = true; return; }
  reconciling = true;
  try {
    do {
      again = false;
      await reconcileOnce();
    } while (again);
  } finally {
    reconciling = false;
  }
}

/** Accounts added or changed in the app (connected in onboarding, say) start within seconds rather than at the
 *  next tick. Debounced, because the app saves an account row and then its credentials. */
function watchAccounts() {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const soon = () => {
    clearTimeout(timer);
    timer = setTimeout(() => reconcile().catch((err) => log.error("reconcile failed", { code: errorCode(err) })), ACCOUNT_SETTLE_MS);
  };
  db.channel("accounts")
    .on("postgres_changes", { event: "INSERT", schema: "public", table: "accounts" }, soon)
    .on("postgres_changes", { event: "UPDATE", schema: "public", table: "accounts" }, (p) => {
      // The worker's own sync progress lands here too. Only connecting (a new sign-in, a resume) and pausing
      // change which connectors run; a WhatsApp link's code updates while connecting cost one cheap pass each.
      const status = (p.new as Tables<"accounts">).status;
      if (status === "connecting" || status === "disconnected") soon();
    })
    .subscribe();
}

async function reconcileOnce() {
  // Each account with when its credentials last changed, in one read.
  const rows = await openAddressRows(must(
    await db.from("accounts").select("*, account_credentials(updated_at)").in("provider", Object.keys(CONNECTORS)),
    "load accounts",
  ));
  const ids = new Set(rows.map((a) => a.id));

  for (const { account_credentials: credentials, ...account } of rows) {
    const current = running.get(account.id);
    const updatedAt = credentials?.updated_at;
    const wanted = account.status !== "disconnected" && updatedAt !== undefined;

    if (!wanted) {
      if (current && (await stopConnector(account.id, current))) {
        running.delete(account.id);
        log.info("connector stopped", { account: account.id });
      }
      continue;
    }
    if (current && current.credentialsUpdatedAt === updatedAt) continue;

    if (current) {
      if (!(await stopConnector(account.id, current))) continue; // new credentials: restart with them
      running.delete(account.id);
    }
    // One account that fails to start must not stop the rest: it is tried again on the next pass.
    try {
      const connector = CONNECTORS[account.provider](account);
      connector.start();
      running.set(account.id, { connector, credentialsUpdatedAt: updatedAt! });
      log.info("connector started", { account: account.id, provider: account.provider });
    } catch (err) {
      log.error("connector start failed", { account: account.id, provider: account.provider, code: errorCode(err) });
    }
  }

  for (const [id, entry] of running) {
    if (!ids.has(id) && (await stopConnector(id, entry))) running.delete(id);
  }
}

const dispatching = new Set<string>();

/**
 * Hands one queued row to its connector, at most once at a time. The id is held from before the first
 * await, so the Realtime and poll paths cannot both hand on the same row. `prepare` returns the work to
 * start, or null to leave the row for a later pass.
 */
async function dispatchOnce(id: string, prepare: () => Promise<(() => Promise<void>) | null>, onError: (err: unknown) => void) {
  if (dispatching.has(id)) return;
  dispatching.add(id);
  let work: (() => Promise<void>) | null = null;
  try {
    work = await prepare();
  } finally {
    if (!work) dispatching.delete(id);
  }
  if (!work) return;
  work()
    .catch(onError)
    .finally(() => dispatching.delete(id));
}

/** An outbox row, with its sending account embedded when it came from the poll. */
type QueuedOutbox = OutboxRow & {
  threads?: { account_id: string; accounts: { status: string } | null } | null;
  accounts?: { id: string; status: string } | null;
};

async function queuedOutbox(): Promise<QueuedOutbox[]> {
  return must(
    await db
      .from("outbox")
      .select("*, threads!outbox_thread_id_fkey(account_id, accounts(status)), accounts(id, status)")
      .eq("status", "queued")
      .order("created_at")
      .limit(50),
    "load outbox",
  );
}

/** Which account sends a queued email: its conversation's for a reply, the one it names for a new email. */
async function sendingAccount(row: QueuedOutbox): Promise<{ id: string; status: string | undefined } | null> {
  if (row.thread_id) {
    const thread =
      row.threads !== undefined
        ? row.threads
        : must(await db.from("threads").select("account_id, accounts(status)").eq("id", row.thread_id).maybeSingle(), "load reply account");
    return thread && { id: thread.account_id, status: thread.accounts?.status };
  }
  if (!row.account_id) return null;
  if (row.accounts !== undefined) return row.accounts;
  return must(await db.from("accounts").select("id, status").eq("id", row.account_id).maybeSingle(), "load send account");
}

/** Fails a row for a broken account, only while it is still queued: one already claimed is left alone. */
async function failQueuedOutbox(id: string, reason: string) {
  must(await db.from("outbox").update({ status: "failed", error: reason }).eq("id", id).eq("status", "queued"), "fail outbox for account");
}

/** Hands queued replies and new emails to their account's connector. Ones for a broken account fail with a reason. */
async function dispatchOutbox(rows?: QueuedOutbox[]) {
  const list = rows ?? (await queuedOutbox());
  for (const queuedRow of list) {
    if (queuedRow.status !== "queued") continue;
    const { threads: _thread, accounts: _account, ...row } = queuedRow;
    await dispatchOnce(
      row.id,
      async () => {
        const account = await sendingAccount(queuedRow);
        if (!account) return null;
        if (account.status === "error" || account.status === "disconnected") {
          await failQueuedOutbox(row.id, "This account needs attention. Reconnect it in Settings, then send again.");
          return null;
        }
        const connector = running.get(account.id)?.connector;
        if (!connector?.send) return null; // starting up: picked up on the next pass
        const send = connector.send.bind(connector);
        return () => withAttachmentSlot(row, () => send(row));
      },
      (err) => log.error("send failed", { outbox: row.id, code: errorCode(err) }),
    );
  }
}

type QueuedAction = Tables<"mail_actions"> & { threads?: { account_id: string } | null };

/** Read, unread, archive and unarchive made in the app, applied in the order they were made. */
async function dispatchMailActions(rows?: QueuedAction[]) {
  const accountIds = [...running.keys()];
  if (!rows && accountIds.length === 0) return;
  const list =
    rows ??
    must(
      await db
        .from("mail_actions")
        .select("*, threads!inner(account_id)")
        .eq("status", "queued")
        .in("threads.account_id", accountIds)
        .order("created_at")
        .limit(100),
      "load mail actions",
    );
  for (const queuedRow of list) {
    if (queuedRow.status !== "queued") continue;
    const { threads: _thread, ...row } = queuedRow;
    await dispatchOnce(
      row.id,
      async () => {
        const accountId =
          queuedRow.threads !== undefined
            ? queuedRow.threads?.account_id
            : must(await db.from("threads").select("account_id").eq("id", row.thread_id).maybeSingle(), "load action thread")?.account_id;
        const connector = accountId ? running.get(accountId)?.connector : undefined;
        if (!connector?.applyAction) return null;
        const apply = connector.applyAction.bind(connector);
        return () => apply(row);
      },
      (err) => log.error("mail action failed", { code: errorCode(err) }),
    );
  }
}

async function dispatchUnsubscribes(rows?: Tables<"unsubscribes">[]) {
  const accountIds = [...running.keys()];
  if (!rows && accountIds.length === 0) return;
  const list =
    rows ??
    must(
      await db.from("unsubscribes").select("*").eq("status", "queued").in("account_id", accountIds).order("created_at").limit(50),
      "load unsubscribes",
    );
  for (const row of list) {
    if (row.status !== "queued") continue;
    await dispatchOnce(
      row.id,
      async () => {
        const connector = running.get(row.account_id)?.connector;
        if (!connector?.unsubscribe) return null;
        const unsubscribe = connector.unsubscribe.bind(connector);
        return () => unsubscribe(row);
      },
      (err) => log.error("unsubscribe failed", { code: errorCode(err) }),
    );
  }
}

type CalendarAccount = { id: string; provider: string; status: string };

/** The accounts named by queued calendar rows, in one read. */
async function calendarAccounts(rows: { account_id: string }[]): Promise<Map<string, CalendarAccount>> {
  const ids = [...new Set(rows.map((row) => row.account_id))];
  if (ids.length === 0) return new Map();
  const accounts = must(await db.from("accounts").select("id, provider, status").in("id", ids), "load calendar accounts");
  return new Map(accounts.map((account) => [account.id, account]));
}

/** Why a calendar account cannot take queued work, or null when it can. */
function calendarAccountProblem(account: CalendarAccount, verb: "added to" | "deleted from" | "changed in"): string | null {
  // Changing an event also works in Outlook Calendar; creating and deleting are Google and iCloud only.
  const outlook = verb === "changed in" && account.provider === "outlook_calendar";
  if (account.provider !== "google_calendar" && account.provider !== "icloud_calendar" && !outlook) {
    return `Events can only be ${verb} a Google Calendar or iCloud Calendar account for now.`;
  }
  if (account.status === "error" || account.status === "disconnected") {
    if (account.provider === "icloud_calendar") return "iCloud Calendar needs attention. Run pnpm connect:icloud-calendar to reconnect, then try again.";
    if (outlook) return "Outlook Calendar needs attention. Run pnpm connect:microsoft to reconnect, then try again.";
    return "Google Calendar needs attention. Reconnect Google in Settings, Connected Accounts, then try again.";
  }
  return null;
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
) {
  const queued = list.filter((row) => row.status === "queued");
  const accounts = await calendarAccounts(queued);
  for (const row of queued) {
    await dispatchOnce(
      row.id,
      async () => {
        const account = accounts.get(row.account_id);
        if (!account) return null;
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
      (err) => log.error(`${what} failed`, { event: row.id, code: errorCode(err) }),
    );
  }
}

/** Events made in the app. */
async function dispatchCalendarOutbox(rows?: CalendarOutboxRow[]) {
  await dispatchCalendar(rows ?? (await queuedEvents()), "added to", failEvent, (c) => c.createEvent?.bind(c), "calendar event");
}

/** Events the app asked to delete. Outlook cannot delete yet. */
async function dispatchCalendarDeletes(rows?: CalendarDeleteRow[]) {
  await dispatchCalendar(rows ?? (await queuedDeletes()), "deleted from", failDelete, (c) => c.deleteEvent?.bind(c), "calendar delete");
}

/** Changes to events, and answers to invitations, made in the app. */
async function dispatchCalendarUpdates(rows?: CalendarUpdateRow[]) {
  await dispatchCalendar(rows ?? (await queuedUpdates()), "changed in", failUpdate, (c) => c.updateEvent?.bind(c), "calendar update");
}

/** The connector's handler for a queued task change, or undefined when it has none. */
function taskHandler(connector: Connector, action: string): ((row: TaskUpdateRow) => Promise<void>) | undefined {
  const handler = action === "create" ? connector.createTask : action === "update" ? connector.editTask : action === "delete" ? connector.deleteTask : connector.updateTask;
  return handler?.bind(connector);
}

/**
 * Tasks ticked, made, changed and deleted in the app, one task at a time, oldest first: of several ticks for a
 * task the latest is made and the earlier are superseded, while creates, updates and deletes are all made
 * (tasks/index.ts has the contract). The queue is read again for each task once its lock is held, so a change
 * that arrived through Realtime cannot overtake an older one waiting in the poll.
 */
async function dispatchTaskUpdates(rows?: TaskUpdateRow[]) {
  const list = rows ?? (await queuedTaskUpdates());
  // A change to a task that is gone (its row removed, which clears task_id) has nothing left to change.
  // Left alone for a user with iCloud Reminders: the AI worker's connector settles such rows for its own user.
  const orphans = list.filter((r) => r.status === "queued" && !r.task_id && r.action !== "create");
  const reminders = await usersWithReminders([...new Set(orphans.map((r) => r.user_id))]);
  const gone = orphans.filter((r) => !reminders.has(r.user_id));
  await failTaskUpdates(gone, TASK_GONE);
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
        if (!account) return null; // the task is gone, and its ticks with it
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

// A View Original request is answered within seconds; a fetched original is deleted after an hour. A failed request
// stores only a code (not_found, gone, no_layout, unreachable), never text from the provider; the app words it.
const ORIGINAL_KEEP_MS = 60 * 60 * 1000;

type OriginalRequest = Tables<"email_originals">;

async function finishOriginal(id: string, patch: Partial<OriginalRequest>) {
  must(await db.from("email_originals").update(patch).eq("id", id), "save original");
}

/**
 * View Original: the email fetched from Gmail, Outlook or iCloud, its HTML encrypted for the person who asked.
 * The HTML is never stored with the message, only on the request, which is deleted after an hour.
 */
async function dispatchOriginals(rows?: OriginalRequest[]) {
  const list = rows ?? must(await db.from("email_originals").select("*").eq("status", "queued").order("created_at").limit(20), "load original requests");
  for (const row of list) {
    if (row.status !== "queued") continue;
    await dispatchOnce(
      row.id,
      async () => {
        const message = must(await db.from("messages").select("account_id, user_id, provider_meta").eq("id", row.message_id).maybeSingle(), "load original's email");
        if (!message || message.user_id !== row.user_id) return () => finishOriginal(row.id, { status: "failed", error: "not_found" });
        const connector = running.get(message.account_id)?.connector;
        if (!connector?.original) return null; // still connecting: the next poll picks it up
        const fetchOriginal = connector.original.bind(connector);
        return async () => {
          await finishOriginal(row.id, { status: "working" });
          try {
            const html = await fetchOriginal(message.provider_meta);
            if (html === "missing") await finishOriginal(row.id, { status: "failed", error: "gone" });
            else if (html === null) await finishOriginal(row.id, { status: "failed", error: "no_layout" });
            else await finishOriginal(row.id, { status: "done", html: await seal(row.user_id, FIELD.html, html) });
          } catch (err) {
            log.warn("original fetch failed", { code: errorCode(err) });
            await finishOriginal(row.id, { status: "failed", error: "unreachable" });
          }
        };
      },
      (err) => log.error("original failed", { code: errorCode(err) }),
    );
  }
}

/** Removes fetched originals after ORIGINAL_KEEP_MS, so an email's HTML is only ever held briefly. */
async function expireOriginals() {
  must(await db.from("email_originals").delete().lt("created_at", new Date(Date.now() - ORIGINAL_KEEP_MS).toISOString()), "expire originals");
}

/** Work the app asks for arrives through Realtime at once, with a poll as a safety net. */
function watchQueues() {
  const guard = (what: string, work: Promise<void>) => work.catch((err) => log.error(`${what} failed`, { code: errorCode(err) }));
  // A queued item arriving means someone is using the app: the safety-net poll and Gmail checks speed up.
  const live = (what: string, work: Promise<void>) => { markActivity(); return guard(what, work); };
  db.channel("queues")
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
      void live("originals", dispatchOriginals([p.new as OriginalRequest])))
    .subscribe();
  // A safety net for a missed Realtime event (queued work normally arrives at once): every 15 s while the
  // app is in use, backing off to 60 s then 120 s when quiet. A queued item snaps it back.
  let lastExpire = 0;
  const poll = () => {
    void guard("outbox", dispatchOutbox());
    void guard("mail actions", dispatchMailActions());
    void guard("unsubscribes", dispatchUnsubscribes());
    void guard("calendar outbox", dispatchCalendarOutbox());
    void guard("calendar deletes", dispatchCalendarDeletes());
    void guard("calendar updates", dispatchCalendarUpdates());
    void guard("task updates", dispatchTaskUpdates());
    void guard("originals", dispatchOriginals());
    if (Date.now() - lastExpire >= EXPIRE_ORIGINALS_MS) {
      lastExpire = Date.now();
      void guard("expire originals", expireOriginals());
    }
  };
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

async function main() {
  log.info("worker starting");
  process.on("unhandledRejection", (err) => log.error("unhandled rejection", { code: errorCode(err) }));
  await Promise.all([
    failInterrupted(),
    failInterruptedEvents(), // an event cut off by a restart may exist in Google Calendar already
    failInterruptedDeletes(), // and a delete cut off by one may have happened
    failInterruptedUpdates(), // and so may a change
    failInterruptedTaskUpdates(), // and a tick of a task
    // An unsubscribe cut off by a restart may have sent its email already, so it is failed, not repeated.
    db
      .from("unsubscribes")
      .update({ status: "failed", error: "Unsubscribing was interrupted. Try again if their emails keep coming.", done_at: new Date().toISOString() })
      .eq("status", "working")
      .then((result) => must(result, "fail interrupted unsubscribes")),
  ]);
  // iCloud Reminders arrive from Konva Relay on the user's Mac, which needs somewhere to reach. A port in use
  // leaves only that off.
  if (env.relayPort) await startRelayServer({ port: env.relayPort, host: env.relayHost, find: relayAccount }).catch((err) => log.error("reminders relay failed to start", { code: errorCode(err) }));
  await reconcile();
  watchAccounts();
  watchQueues();
  startPhotoSync();
  startCompanyLogos();
  startOutboxCleanup();
  startContactLinker(); // finds and merges contacts that are one person
  startAddressIndexer(); // blind indexes for rows written without one
  startMeetingLinker(); // ties Teams, Zoom and Meet meetings to contacts and calendar events
  startUsageRollup(USAGE_ROLLUP_MS); // folds ai_usage rows older than 90 days into monthly totals
  startShareJobs(); // moves chats marked as work (or moved back) between the agent's key and the team's
  startTeamKeyRotation(); // new team key version after a member leaves, then re-seals the team's content under it
  startTeamRules(); // shares chats with team clients (or suggests them), and suggests chats triage marked as work
  setInterval(() => reconcile().catch((err) => log.error("reconcile failed", { code: errorCode(err) })), RECONCILE_MS);

  const shutdown = async () => {
    log.info("worker stopping");
    setTimeout(() => process.exit(1), SHUTDOWN_MS).unref(); // a stop() that hangs must not block exit
    await Promise.all([...running.entries()].map(([id, r]) => stopConnector(id, r)));
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((err) => {
  log.error("worker failed to start", { code: errorCode(err) });
  process.exit(1);
});
