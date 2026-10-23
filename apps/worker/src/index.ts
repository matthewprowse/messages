import { db, must } from "./db";
import { log, errorCode } from "./log";
import { ICloudConnector } from "./connectors/icloud";
import { GmailConnector } from "./connectors/gmail";
import { GoogleCalendarConnector, failEvent, failInterruptedEvents, queuedEvents } from "./connectors/google-calendar";
import type { CalendarOutboxRow } from "./calendar/create-event";
import { WhatsAppConnector } from "./connectors/whatsapp";
import { startPhotoSync } from "./photos/job";
import { startContactLinker } from "./contacts/linker";
import { startAddressIndexer } from "./address-indexer";
import type { AccountRow } from "./db";
import type { Json, Tables } from "@messages/db";
import { FIELD } from "@messages/crypto/fields";
import { openAddressRows, seal } from "./vault";
import { failInterrupted, type OutboxRow } from "./send/outbox";
import { startOutboxCleanup, withAttachmentSlot } from "./send/outbox-attachments";

// The always-on sync worker. Every 30 seconds it reconciles running connectors with the accounts table:
// new accounts start, disconnected ones stop, and accounts with fresh credentials restart. Work queued
// in the app (replies and new emails, mail actions, unsubscribes, calendar events) arrives through
// Realtime and a poll, and is handed to the account's connector. Alongside run photo sync, the contact
// linker, and a daily cleanup of files sent with old outbox rows.

const RECONCILE_MS = 30_000;
const OUTBOX_POLL_MS = 15_000; // a safety net: new replies normally arrive through Realtime at once
const SHUTDOWN_MS = 10_000;

/** What every connector does. Mail connectors also send replies, apply app actions and unsubscribe. */
interface Connector {
  start(): void;
  stop(): Promise<void>;
  send?(row: OutboxRow): Promise<void>;
  applyAction?(row: Tables<"mail_actions">): Promise<void>;
  unsubscribe?(row: Tables<"unsubscribes">): Promise<void>;
  /** Google Calendar only: creates an event queued in the app. */
  createEvent?(row: CalendarOutboxRow): Promise<void>;
  /** Email only: the email as sent (its HTML), fetched for View Original. "missing" when it is gone. */
  original?(meta: Json): Promise<string | null | "missing">;
}

const CONNECTORS: Record<string, (account: AccountRow) => Connector> = {
  icloud: (account) => new ICloudConnector(account),
  gmail: (account) => new GmailConnector(account),
  google_calendar: (account) => new GoogleCalendarConnector(account),
  whatsapp: (account) => new WhatsAppConnector(account),
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

/** One pass at a time: a slow stop() must not let the next tick start a second connector for an account. */
async function reconcile() {
  if (reconciling) return;
  reconciling = true;
  try {
    await reconcileOnce();
  } finally {
    reconciling = false;
  }
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

    if (current && !(await stopConnector(account.id, current))) continue; // new credentials: restart with them
    const connector = CONNECTORS[account.provider](account);
    connector.start();
    running.set(account.id, { connector, credentialsUpdatedAt: updatedAt! });
    log.info("connector started", { account: account.id, provider: account.provider });
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
      .select("*, threads(account_id, accounts(status)), accounts(id, status)")
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

/** Events made in the app, handed to their Google Calendar account. Ones for a broken account fail with a reason. */
async function dispatchCalendarOutbox(rows?: CalendarOutboxRow[]) {
  const list = rows ?? (await queuedEvents());
  for (const row of list) {
    if (row.status !== "queued") continue;
    await dispatchOnce(
      row.id,
      async () => {
        const account = must(await db.from("accounts").select("id, provider, status").eq("id", row.account_id).maybeSingle(), "load calendar account");
        if (!account) return null;
        if (account.provider !== "google_calendar") {
          await failEvent(row.id, "Events can only be added to a Google Calendar account.");
          return null;
        }
        if (account.status === "error" || account.status === "disconnected") {
          await failEvent(row.id, "Google Calendar needs attention. Run pnpm connect:google to reconnect, then try again.");
          return null;
        }
        const connector = running.get(account.id)?.connector;
        if (!connector?.createEvent) return null; // starting up: picked up on the next pass
        const createEvent = connector.createEvent.bind(connector);
        return () => createEvent(row);
      },
      (err) => log.error("calendar event failed", { event: row.id, code: errorCode(err) }),
    );
  }
}

// A View Original request is answered within seconds; a fetched original is deleted after an hour.
const ORIGINAL_KEEP_MS = 60 * 60 * 1000;

type OriginalRequest = Tables<"email_originals">;

async function finishOriginal(id: string, patch: Partial<OriginalRequest>) {
  must(await db.from("email_originals").update(patch).eq("id", id), "save original");
}

/**
 * View Original: the email fetched from Gmail or iCloud, its HTML encrypted for the person who asked.
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
        if (!message || message.user_id !== row.user_id) return () => finishOriginal(row.id, { status: "failed", error: "This email could not be found." });
        const connector = running.get(message.account_id)?.connector;
        if (!connector?.original) return null; // still connecting: the next poll picks it up
        const fetchOriginal = connector.original.bind(connector);
        return async () => {
          await finishOriginal(row.id, { status: "working" });
          try {
            const html = await fetchOriginal(message.provider_meta);
            if (html === "missing") await finishOriginal(row.id, { status: "failed", error: "This email is no longer in your mailbox." });
            else if (html === null) await finishOriginal(row.id, { status: "failed", error: "This email has no original layout to show." });
            else await finishOriginal(row.id, { status: "done", html: await seal(row.user_id, FIELD.html, html) });
          } catch (err) {
            log.warn("original fetch failed", { code: errorCode(err) });
            await finishOriginal(row.id, { status: "failed", error: "Your mailbox could not be reached. Try again." });
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
  db.channel("queues")
    .on("postgres_changes", { event: "INSERT", schema: "public", table: "outbox" }, (p) => void guard("outbox", dispatchOutbox([p.new as OutboxRow])))
    .on("postgres_changes", { event: "INSERT", schema: "public", table: "mail_actions" }, (p) =>
      void guard("mail actions", dispatchMailActions([p.new as Tables<"mail_actions">])))
    .on("postgres_changes", { event: "INSERT", schema: "public", table: "unsubscribes" }, (p) =>
      void guard("unsubscribes", dispatchUnsubscribes([p.new as Tables<"unsubscribes">])))
    .on("postgres_changes", { event: "INSERT", schema: "public", table: "calendar_outbox" }, (p) =>
      void guard("calendar outbox", dispatchCalendarOutbox([p.new as CalendarOutboxRow])))
    .on("postgres_changes", { event: "INSERT", schema: "public", table: "email_originals" }, (p) =>
      void guard("originals", dispatchOriginals([p.new as OriginalRequest])))
    .subscribe();
  const poll = () => {
    void guard("outbox", dispatchOutbox());
    void guard("mail actions", dispatchMailActions());
    void guard("unsubscribes", dispatchUnsubscribes());
    void guard("calendar outbox", dispatchCalendarOutbox());
    void guard("originals", dispatchOriginals());
    void guard("expire originals", expireOriginals());
  };
  setInterval(poll, OUTBOX_POLL_MS);
  poll();
}

async function main() {
  log.info("worker starting");
  process.on("unhandledRejection", (err) => log.error("unhandled rejection", { code: errorCode(err) }));
  await Promise.all([
    failInterrupted(),
    failInterruptedEvents(), // an event cut off by a restart may exist in Google Calendar already
    // An unsubscribe cut off by a restart may have sent its email already, so it is failed, not repeated.
    db
      .from("unsubscribes")
      .update({ status: "failed", error: "Unsubscribing was interrupted. Try again if their emails keep coming.", done_at: new Date().toISOString() })
      .eq("status", "working")
      .then((result) => must(result, "fail interrupted unsubscribes")),
  ]);
  await reconcile();
  watchQueues();
  startPhotoSync();
  startOutboxCleanup();
  startContactLinker(); // finds and merges contacts that are one person
  startAddressIndexer(); // blind indexes for rows written without one
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
