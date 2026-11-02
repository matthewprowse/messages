// Loads the Attachments library: every file from every conversation, newest message first.

import { openAddresses } from "../open-rows";
import { supabase } from "../supabase";
import type { Attachment, FiledAttachment } from "../types";
import { withSealedColumns } from "../sealed-columns";
import { mapAttachment } from "./map-message";
import { myId } from "./load-small";

const ATTACHMENT_LIMIT = 1000;

/**
 * Every file from every conversation, newest message first. Hidden files only when asked for.
 * Voice notes and stickers belong to their chats and are left out: this is the library of pictures,
 * video, PDFs and documents.
 */
export async function loadAttachments(includeHidden = false): Promise<FiledAttachment[]> {
  let query = supabase
    .from("attachments")
    .select(await withSealedColumns("id, filename, kind, size_bytes, storage_path, hidden_reason, sealed, not_kept, messages!inner(id, thread_id, sent_at, direction, sender_contact_id, threads!inner(status))"))
    .eq("user_id", await myId())
    // Files in deleted conversations (in the provider's bin) are left out, as the conversations are.
    .neq("messages.threads.status", "trash")
    .neq("kind", "audio")
    .eq("is_sticker", false)
    .order("created_at", { ascending: false })
    .limit(ATTACHMENT_LIMIT);
  if (!includeHidden) query = query.eq("hidden", false);
  const { data: sealedRows, error } = await query;
  if (error) throw error;
  const data = await openAddresses(sealedRows);
  return data
    .flatMap(({ messages: m, ...a }) =>
      m
        ? [{
            ...mapAttachment(a),
            hiddenReason: (a.hidden_reason as Attachment["hiddenReason"]) ?? undefined,
            messageId: m.id,
            threadId: m.thread_id,
            sentAt: m.sent_at,
            from: m.direction === "outbound" ? "me" : m.sender_contact_id ?? "unknown",
          }]
        : [],
    )
    .sort((a, b) => b.sentAt.localeCompare(a.sentAt));
}
