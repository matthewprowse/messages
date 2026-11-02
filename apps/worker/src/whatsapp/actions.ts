// App actions on a WhatsApp chat: a reaction sent over the link, and read receipts for chats you opened. The
// connector (connectors/whatsapp.ts) checks the link is up first, and queues nothing here itself.

import type { WASocket } from "baileys";
import type { Tables } from "@messages/db";
import { db, must } from "../db";
import { log, errorCode } from "../log";
import { finishAction } from "../send/actions";
import { openAddresses } from "../vault";
import { SELF } from "./reactions";
import type { AccountCtx, StoredMeta } from "./person";

/**
 * A 'read' action means you opened the chat in the app. Only then, and only with read receipts on in
 * Settings, does WhatsApp hear that you read the messages. A 'react' action sends your reaction (an
 * empty emoji removes it). Archive and unarchive are app-only here. Always settles the action.
 */
export async function applyWhatsAppAction(ctx: AccountCtx, sock: WASocket, row: Tables<"mail_actions">) {
  try {
    if (row.action === "react" && row.message_id) {
      const target = must(
        await db.from("messages").select("provider_message_id, direction, provider_meta, thread_id, threads(provider_thread_id)").eq("id", row.message_id).eq("account_id", ctx.accountId).maybeSingle(),
        "load reaction target",
      );
      await openAddresses(ctx.userId, target);
      if (!target || target.thread_id !== row.thread_id || !target.threads) throw Object.assign(new Error("no target"), { code: "NO_TARGET" });
      const meta = target.provider_meta as unknown as StoredMeta;
      const key = { remoteJid: target.threads.provider_thread_id, id: target.provider_message_id, fromMe: target.direction === "outbound", participant: meta.participant ?? undefined };
      await sock.sendMessage(target.threads.provider_thread_id, { react: { text: row.emoji ?? "", key } });
      must(await db.rpc("whatsapp_react", { p_account_id: ctx.accountId, p_provider_message_id: target.provider_message_id, p_sender: SELF, p_emoji: row.emoji ?? "" }), "save my reaction");
      log.info("whatsapp reaction sent", { account: ctx.accountId, action: row.id });
    }
    if (row.action === "read") {
      const pending = must(
        await db
          .from("messages")
          .select("id, provider_message_id, provider_meta")
          .eq("thread_id", row.thread_id)
          .eq("account_id", ctx.accountId)
          .eq("direction", "inbound")
          .eq("provider_meta->>receipt", "pending")
          .limit(500),
        "load unread whatsapp messages",
      );
      await openAddresses(ctx.userId, pending);
      if (pending.length > 0) {
        const profile = must(await db.from("profiles").select("whatsapp_read_receipts").eq("user_id", row.user_id).maybeSingle(), "load profile");
        const on = profile?.whatsapp_read_receipts === true;
        if (on) {
          const keys = pending.map((m) => {
            const meta = m.provider_meta as unknown as StoredMeta;
            return { remoteJid: meta.chat, id: m.provider_message_id, participant: meta.participant ?? undefined, fromMe: false };
          });
          await sock.readMessages(keys);
        }
        must(
          await db.rpc("whatsapp_set_receipt", { p_account_id: ctx.accountId, p_message_ids: pending.map((m) => m.id), p_state: on ? "sent" : "skipped" }),
          "record receipts",
        );
        log.info("whatsapp read receipts", { account: ctx.accountId, messages: pending.length, sent: on });
      }
    }
    await finishAction(row.id);
  } catch (err) {
    log.warn("whatsapp action failed", { account: ctx.accountId, action: row.action, code: errorCode(err) });
    await finishAction(row.id, row.action === "react" ? "Could not send your reaction to WhatsApp." : "Could not tell WhatsApp you read this chat.");
  }
}
