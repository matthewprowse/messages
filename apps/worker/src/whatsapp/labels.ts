// Saves WhatsApp Business labels as Konva labels (label-map.ts decides what to save). A label's name is the user's own text, so it
// is sealed. A label put on a chat reaches the conversation through its blind index; a chat not stored yet is skipped, and the
// next change to that label reaches it. One way: nothing here writes back to WhatsApp.

import type { BaileysEventMap } from "baileys";
import { chatIndex } from "@messages/crypto/addresses";
import { FIELD } from "@messages/crypto/fields";
import { db, must } from "../db";
import { keysFor, seal } from "../vault";
import { isChatAssociation, mapLabel } from "./label-map";
import type { AccountCtx } from "./person";

/** Creates, renames, recolours or removes the Konva label for each WhatsApp label. */
export async function saveLabels(ctx: AccountCtx, labels: BaileysEventMap["labels.edit"][]) {
  for (const label of labels) {
    const m = mapLabel(label);
    if (!m) continue;
    must(
      await db.rpc("whatsapp_label", { p_account_id: ctx.accountId, p_wa_label_id: m.waId, p_name: (await seal(ctx.userId, FIELD.name, m.name || "Label"))!, p_color: m.color, p_deleted: m.deleted }),
      "save whatsapp label",
    );
  }
}

/** Puts a label on a chat, or takes it off. `alt` is the chat's other JID (phone number or privacy ID) when known. */
export async function saveLabelAssociation(ctx: AccountCtx, event: BaileysEventMap["labels.association"], alt: string | null) {
  const a = event.association;
  if (!isChatAssociation(a.type) || !a.chatId || !a.labelId) return;
  const keys = await keysFor(ctx.userId);
  const indexes = await Promise.all([a.chatId, ...(alt ? [alt] : [])].map((jid) => chatIndex(keys, jid)));
  must(
    await db.rpc("whatsapp_label_chat", { p_account_id: ctx.accountId, p_wa_label_id: a.labelId, p_chat_indexes: indexes, p_add: event.type === "add" }),
    "save whatsapp label chat",
  );
}
