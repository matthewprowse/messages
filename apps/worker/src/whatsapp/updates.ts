// Edits and deletions made in WhatsApp, and the delivery and read ticks of messages you sent, written to the stored
// messages. An edit or a deletion never loses what was said: the database keeps the earlier text as a version
// (message_versions) and the app shows "Edited" or "Deleted by Sender" with View Original. One failing update is logged by
// code and does not stop the rest.

import type { BaileysEventMap } from "baileys";
import { FIELD } from "@messages/crypto/fields";
import { db, must } from "../db";
import { log, errorCode } from "../log";
import { seal } from "../vault";
import type { AccountCtx } from "./person";
import { receiptOf } from "./send-reason";
import { contentChange } from "./update-plan";

export async function applyUpdates(ctx: AccountCtx, updates: BaileysEventMap["messages.update"]) {
  for (const { key, update } of updates) {
    if (!key.id) continue;
    try {
      if (key.fromMe && typeof update.status === "number") {
        const receipt = receiptOf(update.status);
        if (receipt) must(await db.rpc("whatsapp_message_status", { p_account_id: ctx.accountId, p_provider_message_id: key.id, p_status: receipt }), "save receipt");
      }
      const change = contentChange(update, Date.now());
      if (!change) continue;
      if (change.kind === "delete") {
        // The database sets the original aside as a version first, then the message carries this notice, so a deleted
        // message is not read by search or the AI while the person can still open what it said.
        const notice = "This message was deleted.";
        const [body, preview] = await Promise.all([seal(ctx.userId, FIELD.body, notice), seal(ctx.userId, FIELD.preview, notice)]);
        must(
          await db.rpc("whatsapp_update_message", { p_account_id: ctx.accountId, p_provider_message_id: key.id, p_body: body!, p_preview: preview!, p_meta: { deleted: true } }),
          "save deletion",
        );
        continue;
      }
      must(
        await db.rpc("whatsapp_update_message", {
          p_account_id: ctx.accountId,
          p_provider_message_id: key.id,
          p_body: (await seal(ctx.userId, FIELD.body, change.text))!,
          p_preview: (await seal(ctx.userId, FIELD.preview, change.preview))!,
          p_meta: { edited: true, edit_ts: change.editTs },
        }),
        "save edit",
      );
    } catch (err) {
      log.warn("whatsapp update failed", { account: ctx.accountId, code: errorCode(err) });
    }
  }
}
