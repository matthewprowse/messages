// Where a queued WhatsApp message goes and what it quotes: the chat of a reply, the number of a new chat, the stored
// message a reply quotes, and the link from a sent new chat to its conversation. Database and link reads for
// connectors/whatsapp.ts send(); nothing here sends.

import { isPnUser, jidNormalizedUser, type WAMessage, type WASocket } from "baileys";
import { FIELD } from "@messages/crypto/fields";
import { db, must } from "../db";
import { log, errorCode } from "../log";
import { onInboxList, linkThread, type OutboxRow } from "../send/outbox";
import { replyFor } from "../send/inbox";
import { open, openAddresses } from "../vault";
import { newChatNumber } from "./outgoing";
import type { AccountCtx, StoredMeta } from "./person";

/** The chat a reply goes to: its conversation's, which must be a WhatsApp chat on this account and yours. */
export async function replyTarget(ctx: AccountCtx, row: OutboxRow): Promise<{ jid: string } | { error: string }> {
  const thread = must(
    await db.from("threads").select("account_id, user_id, channel, provider_thread_id").eq("id", row.thread_id!).maybeSingle(),
    "load whatsapp thread",
  );
  await openAddresses(ctx.userId, thread);
  // The chat's own person's reply, or a member of the shared inbox it is in (this account's, which they cannot replace).
  const via = thread ? replyFor(thread.user_id, row.user_id, thread.user_id !== row.user_id && (await onInboxList(row.thread_id!, row.user_id))) : "nobody";
  if (!thread || thread.account_id !== ctx.accountId || via === "nobody" || thread.channel !== "whatsapp") {
    return { error: "This message belongs to another account." };
  }
  return { jid: thread.provider_thread_id };
}

/**
 * The chat a new message starts: one number in E.164, checked with WhatsApp first so nothing is sent to
 * a number without an account. A chat that already exists with that number is simply continued.
 */
export async function newChatTarget(ctx: AccountCtx, row: OutboxRow, sock: WASocket): Promise<{ jid: string } | { error: string }> {
  if (row.account_id !== ctx.accountId || row.user_id !== ctx.userId) return { error: "This message belongs to another account." };
  const digits = newChatNumber(row.to_addresses);
  if (!digits) return { error: "Enter one phone number with its country code, like +44 7700 900123." };
  const [found] = (await sock.onWhatsApp(digits)) ?? [];
  if (!found?.exists) return { error: "This number is not on WhatsApp." };
  // WhatsApp may answer with the number's own JID or a privacy ID; a chat is addressed by the number.
  return { jid: isPnUser(found.jid) ? jidNormalizedUser(found.jid) : `${digits}@s.whatsapp.net` };
}

/** Points a sent new chat at its conversation, once stored, so the app can open it. */
export async function linkNewChat(ctx: AccountCtx, outboxId: string, providerMessageId: string) {
  try {
    const stored = must(
      await db.from("messages").select("thread_id").eq("account_id", ctx.accountId).eq("provider_message_id", providerMessageId).maybeSingle(),
      "find new chat",
    );
    if (stored) await linkThread(outboxId, stored.thread_id);
    else log.warn("whatsapp new chat not stored yet", { account: ctx.accountId, outbox: outboxId });
  } catch (err) {
    log.warn("whatsapp link new chat failed", { account: ctx.accountId, outbox: outboxId, code: errorCode(err) });
  }
}

/** A stored message in this chat, in the shape Baileys needs to quote it in a reply. */
export async function quotable(ctx: AccountCtx, messageId: string, threadId: string | null, chatJid: string): Promise<WAMessage | undefined> {
  const m = must(
    await db.from("messages").select("provider_message_id, direction, body_text, provider_meta, thread_id").eq("id", messageId).eq("account_id", ctx.accountId).maybeSingle(),
    "load quoted message",
  );
  await openAddresses(ctx.userId, m);
  if (!m || m.thread_id !== threadId) return undefined;
  const meta = m.provider_meta as unknown as StoredMeta;
  return {
    key: { remoteJid: chatJid, id: m.provider_message_id, fromMe: m.direction === "outbound", participant: meta.participant ?? undefined },
    message: { conversation: (await open(ctx.userId, FIELD.body, m.body_text)) ?? "" },
  };
}
