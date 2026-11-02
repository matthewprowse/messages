// Queued mail work: replies and new emails, read/unread/archive actions, and unsubscribes, handed to the account's
// connector. Rows for an account that is broken fail with a reason; rows of another shard's account are left alone.

import type { Tables } from "@messages/db";
import { db, must } from "../db";
import { readQueued } from "../in-chunks";
import { errorCode, log } from "../log";
import { requeueWorkingActions, STALE_ACTION_MS } from "../recovery";
import { ACCOUNT_ERROR_WAIT_MS, accountVerdict, BROKEN_ACCOUNT_REASON } from "../send/account-wait";
import { applyClaimed } from "../send/actions";
import { failStuckSend, type OutboxRow } from "../send/outbox";
import { withAttachmentSlot } from "../send/outbox-attachments";
import { ownsAccount } from "../shard";
import { dispatching, dispatchOnce, running } from "./state";

/** An outbox row, with its sending account embedded when it came from the poll. */
export type QueuedOutbox = OutboxRow & {
  threads?: { account_id: string; accounts: { status: string } | null } | null;
  accounts?: { id: string; status: string } | null;
};

/**
 * The oldest queued emails of the accounts this worker runs: new emails name their account, replies reach it through their
 * conversation. Rows of accounts it does not run are not read, so they cannot fill the window and starve newer ones.
 */
async function queuedOutbox(): Promise<QueuedOutbox[]> {
  const accountIds = [...running.keys()];
  if (accountIds.length === 0) return [];
  const columns = "*, threads!outbox_thread_id_fkey(account_id, accounts(status)), accounts(id, status)";
  const replyColumns = columns.replace("threads!outbox_thread_id_fkey(", "threads!outbox_thread_id_fkey!inner(");
  const [fresh, replies] = await Promise.all([
    // The select strings are built at run time, so the client cannot type the rows: they are cast to the shape they have.
    readQueued<QueuedOutbox>(accountIds, async (slice) => (await db.from("outbox").select(columns).eq("status", "queued").in("account_id", slice).order("created_at").limit(50)) as unknown as { data: QueuedOutbox[] | null; error: { code?: string } | null }, "load outbox", 50),
    readQueued<QueuedOutbox>(accountIds, async (slice) => (await db.from("outbox").select(replyColumns).eq("status", "queued").in("threads.account_id", slice).order("created_at").limit(50)) as unknown as { data: QueuedOutbox[] | null; error: { code?: string } | null }, "load outbox replies", 50),
  ]);
  const byId = new Map<string, QueuedOutbox>();
  for (const row of [...fresh, ...replies] as QueuedOutbox[]) byId.set(row.id, row);
  return [...byId.values()].sort((a, b) => a.created_at.localeCompare(b.created_at)).slice(0, 50);
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

/**
 * Fails emails still queued after the wait for an account that is not running here (disconnected, or its connector
 * would not start). The poll above only reads running accounts and Realtime can miss the insert, so without this
 * such an email would show as sending for good.
 */
export async function failStrandedOutbox() {
  const cutoff = new Date(Date.now() - ACCOUNT_ERROR_WAIT_MS).toISOString();
  const rows = must(
    await db.from("outbox").select("*, threads!outbox_thread_id_fkey(account_id, accounts(status)), accounts(id, status)").eq("status", "queued").lt("created_at", cutoff).order("created_at").limit(200),
    "load stranded outbox",
  ) as QueuedOutbox[];
  for (const row of rows) {
    const account = await sendingAccount(row);
    if (!account || !ownsAccount(account.id) || running.has(account.id)) continue; // a running account's email is the poll's
    if (accountVerdict(account.status, row.created_at) === "fail") await failQueuedOutbox(row.id, BROKEN_ACCOUNT_REASON);
  }
}

/** Hands queued replies and new emails to their account's connector. Ones for a broken account fail with a reason. */
export async function dispatchOutbox(rows?: QueuedOutbox[]) {
  const list = rows ?? (await queuedOutbox());
  for (const queuedRow of list) {
    if (queuedRow.status !== "queued") continue;
    const { threads: _thread, accounts: _account, ...row } = queuedRow;
    await dispatchOnce(
      row.id,
      async () => {
        const account = await sendingAccount(queuedRow);
        if (!account || !ownsAccount(account.id)) return null; // another shard's account is left queued for it
        const verdict = accountVerdict(account.status, row.created_at);
        if (verdict === "wait") return null; // reconnecting: the poll tries it again, and fails it if the account stays broken
        if (verdict === "fail") {
          await failQueuedOutbox(row.id, BROKEN_ACCOUNT_REASON);
          return null;
        }
        const connector = running.get(account.id)?.connector;
        if (!connector?.send) return null; // starting up: picked up on the next pass
        const send = connector.send.bind(connector);
        return () => withAttachmentSlot(row, () => send(row));
      },
      (err) => {
        log.error("send failed", { outbox: row.id, code: errorCode(err) });
        void failStuckSend(row.id);
      },
    );
  }
}

export type QueuedAction = Tables<"mail_actions"> & { threads?: { account_id: string } | null };

/** Actions left 'working' for over 10 minutes by a run that is gone (not one this worker is still applying) are queued again. */
export function requeueStaleActions() {
  return requeueWorkingActions(new Date(Date.now() - STALE_ACTION_MS), dispatching);
}

/** Read, unread, archive and unarchive made in the app, applied in the order they were made. */
export async function dispatchMailActions(rows?: QueuedAction[]) {
  const accountIds = [...running.keys()];
  if (!rows && accountIds.length === 0) return;
  const list =
    rows ??
    (await readQueued(
      accountIds,
      (slice) => db.from("mail_actions").select("*, threads!inner(account_id)").eq("status", "queued").in("threads.account_id", slice).order("created_at").limit(100),
      "load mail actions",
      100,
    ));
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
        return () => applyClaimed(row.id, apply);
      },
      (err) => log.error("mail action failed", { code: errorCode(err) }),
    );
  }
}

export async function dispatchUnsubscribes(rows?: Tables<"unsubscribes">[]) {
  const accountIds = [...running.keys()];
  if (!rows && accountIds.length === 0) return;
  const list =
    rows ??
    (await readQueued(accountIds, (slice) => db.from("unsubscribes").select("*").eq("status", "queued").in("account_id", slice).order("created_at").limit(50), "load unsubscribes", 50));
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
