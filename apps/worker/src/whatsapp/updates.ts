// Edits and deletions made in WhatsApp, and the delivery and read ticks of messages you sent, written to the stored
// messages. One failing update is logged by code and does not stop the rest.

import { WAMessageStubType, type BaileysEventMap } from "baileys";
import { FIELD } from "@messages/crypto/fields";
import { db, must } from "../db";
import { log, errorCode } from "../log";
import { seal } from "../vault";
import { describe } from "./normalize";
import type { AccountCtx } from "./person";
import { receiptOf } from "./send-reason";

export async function applyUpdates(ctx: AccountCtx, updates: BaileysEventMap["messages.update"]) {
  for (const { key, update } of updates) {
    if (!key.id) continue;
    try {
      if (update.messageStubType === WAMessageStubType.REVOKE) {
        const text = "This message was deleted.";
        const [body, preview] = await Promise.all([seal(ctx.userId, FIELD.body, text), seal(ctx.userId, FIELD.preview, text)]);
        must(
          await db.rpc("whatsapp_update_message", { p_account_id: ctx.accountId, p_provider_message_id: key.id, p_body: body!, p_preview: preview!, p_meta: { deleted: true } }),
          "save deletion",
        );
        continue;
      }
      if (key.fromMe && typeof update.status === "number") {
        const receipt = receiptOf(update.status);
        if (receipt) must(await db.rpc("whatsapp_message_status", { p_account_id: ctx.accountId, p_provider_message_id: key.id, p_status: receipt }), "save receipt");
      }
      const edited = update.message?.editedMessage?.message;
      if (!edited) continue;
      // The new content, sometimes still inside the edit's protocol message.
      const d = describe(edited.protocolMessage?.editedMessage ?? edited);
      if (d.kind !== "message") continue;
      const text = d.text;
      must(
        await db.rpc("whatsapp_update_message", {
          p_account_id: ctx.accountId,
          p_provider_message_id: key.id,
          p_body: (await seal(ctx.userId, FIELD.body, text))!,
          p_preview: (await seal(ctx.userId, FIELD.preview, d.preview))!,
          p_meta: { edited: true },
        }),
        "save edit",
      );
    } catch (err) {
      log.warn("whatsapp update failed", { account: ctx.accountId, code: errorCode(err) });
    }
  }
}
