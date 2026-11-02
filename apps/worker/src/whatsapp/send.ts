// Sends one queued WhatsApp message or reply over the linked device: claim, find the chat, load files, send each part,
// then settle the outbox row. The connector (connectors/whatsapp.ts) passes the live socket and says whether the link
// is still the same one. Every failure ends in markFailed with a plain sentence; nothing is ever sent twice.

import type { AnyMessageContent, WAMessage, WASocket } from "baileys";
import { FIELD } from "@messages/crypto/fields";
import { errorCode, log } from "../log";
import { claimReady, markFailed, settleSent, type OutboxRow } from "../send/outbox";
import { loadAttachmentFiles } from "../send/outbox-attachments";
import { open } from "../vault";
import { outgoingMessages } from "./outgoing";
import type { AccountCtx } from "./person";
import { sendFailureReason } from "./send-reason";
import { linkNewChat, newChatTarget, quotable, replyTarget } from "./send-target";
import { prepareVoiceNotes } from "./voice-note";

/**
 * Sends one queued reply over the linked device, then stores it so it shows in the conversation. A
 * reply with files goes as one message per file, the text as the first one's caption, and a voice
 * note recorded in the app is converted to the format WhatsApp needs first. Claimed first
 * (once its files have arrived), so it can never go out twice. `linkIsCurrent` is false once the link
 * dropped or was replaced; `storeSent` stores what went out.
 */
export async function sendQueued(
  ctx: AccountCtx,
  sock: WASocket,
  queuedRow: OutboxRow,
  linkIsCurrent: () => boolean,
  storeSent: (messages: WAMessage[], outboxId: string) => Promise<void>,
) {
  const row = await claimReady(queuedRow); // waits for its files, then claims it
  if (!row) return;
  if (!linkIsCurrent()) {
    // The link dropped while the files arrived. Nothing has gone out, so this is safe to send again.
    await markFailed(row.id, "WhatsApp is not connected, so nothing was sent. Try again.");
    return;
  }
  let chatJid: string;
  try {
    const target = row.thread_id ? await replyTarget(ctx, row) : await newChatTarget(ctx, row, sock);
    if ("error" in target) {
      await markFailed(row.id, target.error);
      return;
    }
    chatJid = target.jid;
  } catch (err) {
    log.warn("whatsapp send target failed", { account: ctx.accountId, outbox: row.id, code: errorCode(err) });
    await markFailed(row.id, "WhatsApp could not be reached, so nothing was sent. Try again.").catch(() => undefined);
    return;
  }

  let parts: AnyMessageContent[];
  try {
    const files = row.attachment_count > 0 ? await loadAttachmentFiles(row, "whatsapp") : [];
    if ("error" in files) {
      await markFailed(row.id, files.error);
      return;
    }
    const ready = await prepareVoiceNotes(files, { account: ctx.accountId, outbox: row.id });
    if ("error" in ready) {
      await markFailed(row.id, ready.error);
      return;
    }
    parts = outgoingMessages((await open(row.user_id, FIELD.body, row.body)) ?? "", ready);
  } catch (err) {
    log.warn("whatsapp attachments failed", { account: ctx.accountId, outbox: row.id, code: errorCode(err) });
    await markFailed(row.id, "The attachments could not be read. Try again.").catch(() => undefined);
    return;
  }
  if (parts.length === 0) {
    await markFailed(row.id, "There is nothing to send.");
    return;
  }

  const sent: WAMessage[] = [];
  try {
    const quoted = row.thread_id && row.reply_to_message_id ? await quotable(ctx, row.reply_to_message_id, row.thread_id, chatJid) : undefined;
    for (const [i, part] of parts.entries()) {
      const message = await sock.sendMessage(chatJid, part, i === 0 && quoted ? { quoted } : undefined);
      if (!message?.key.id) throw Object.assign(new Error("no message id"), { code: "NO_ID" });
      sent.push(message);
    }
  } catch (err) {
    log.warn("whatsapp reply failed", { account: ctx.accountId, outbox: row.id, code: errorCode(err), sentParts: sent.length, parts: parts.length });
    await markFailed(row.id, sendFailureReason(sent.length, parts.length)).catch(() => undefined);
    await storeSent(sent, row.id);
    return;
  }
  if (!(await settleSent(row.id, sent[0].key.id!))) log.warn("whatsapp reply sent but not recorded", { account: ctx.accountId, outbox: row.id });
  else log.info(row.thread_id ? "whatsapp reply sent" : "whatsapp new chat sent", { account: ctx.accountId, outbox: row.id, parts: sent.length });
  await storeSent(sent, row.id);
  if (!row.thread_id) await linkNewChat(ctx, row.id, sent[0].key.id!);
}
