// What a WhatsApp message update means for the stored message: the sender deleted it, edited it, or it is not a change to its
// content at all. Pure, so the rules (an edit needs readable new text, a redelivered edit carries the same time) are tested
// without a connection. updates.ts does the writing; the database keeps the original (public.whatsapp_update_message).

import { WAMessageStubType, type proto } from "baileys";
import { describe } from "./normalize";

export type ContentChange =
  | { kind: "delete" }
  | { kind: "edit"; text: string; preview: string; editTs: number }
  | null;

/** The deletion or edit in a messages.update `update`, or null. `now` stands in when an edit carries no time. */
export function contentChange(update: { messageStubType?: number | null; message?: proto.IMessage | null }, now: number): ContentChange {
  if (update.messageStubType === WAMessageStubType.REVOKE) return { kind: "delete" };
  const edited = update.message?.editedMessage?.message;
  if (!edited) return null;
  // The new content, sometimes still inside the edit's protocol message.
  const d = describe(edited.protocolMessage?.editedMessage ?? edited);
  if (d.kind !== "message") return null;
  const at = Number(edited.protocolMessage?.timestampMs ?? 0);
  return { kind: "edit", text: d.text, preview: d.preview, editTs: Number.isFinite(at) && at > 0 ? at : now };
}
