// The database side of the WhatsApp send limits: what an account has sent in the last day, whether a message goes to someone it
// has never chatted with, and holding a message back when a limit is reached. The decisions are in send-rails.ts; this reads
// and writes the outbox. A held message is not failed: it stays queued with send_after moved to when the limit lifts, and
// wait_reason says why, so the app can show "Waiting: Daily WhatsApp Limit".

import { db, must, retryWrite } from "../db";
import type { OutboxRow } from "../send/outbox";
import type { RecentSend, WaitReason } from "./send-rails";

const DAY_MS = 24 * 60 * 60_000;

/** What the account has sent in the last 24 hours, or is sending now. A reply stamps its account when it is taken (stampSend). */
export async function recentSends(accountId: string, now = Date.now()): Promise<RecentSend[]> {
  const since = new Date(now - DAY_MS).toISOString();
  const rows = must(
    await db.from("outbox").select("sent_at, status, cold_chat").eq("account_id", accountId).or(`and(status.eq.sent,sent_at.gte.${since}),status.eq.sending`),
    "load recent whatsapp sends",
  );
  return rows.map((r) => ({ at: r.sent_at ? Date.parse(r.sent_at) : now, cold: r.cold_chat }));
}

/**
 * Whether a message goes to someone this account has never chatted with: a new chat, or a reply in a conversation where they
 * have not written to you. A new chat to a number that already has a conversation counts too, which errs on the side of care.
 */
export async function isColdChat(row: Pick<OutboxRow, "thread_id">): Promise<boolean> {
  if (!row.thread_id) return true;
  const inbound = must(await db.from("messages").select("id").eq("thread_id", row.thread_id).eq("direction", "inbound").limit(1), "check whatsapp history");
  return inbound.length === 0;
}

/** Puts a message back in the queue until `retryAt` (ms) and says why. Only while it is still queued. Never throws. */
export async function holdRow(id: string, reason: WaitReason, retryAt: number) {
  await retryWrite(() => db.from("outbox").update({ send_after: new Date(retryAt).toISOString(), wait_reason: reason }).eq("id", id).eq("status", "queued")).catch(() => false);
}

/** Records on a claimed message which account sends it and whether it counts as a new chat, and clears any waiting reason. */
export async function stampSend(id: string, accountId: string, cold: boolean) {
  await retryWrite(() => db.from("outbox").update({ account_id: accountId, cold_chat: cold, wait_reason: null }).eq("id", id)).catch(() => false);
}
