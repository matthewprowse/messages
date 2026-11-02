// Loads the Attachments library a page at a time: files newest message first, keyed on (sent_at, id) so the order is the
// same on every page. Also counts files, and hides or unhides them. The paging maths is in lib/attachment-pages.ts.

import { openAddresses } from "../open-rows";
import { supabase } from "../supabase";
import type { Attachment, FiledAttachment } from "../types";
import { withSealedColumns } from "../sealed-columns";
import { afterCursorFilter, ATTACHMENT_PAGE, cursorOf, type Cursor } from "../attachment-pages";
import type { Kind } from "../attachment-filters";
import { mapAttachment } from "./map-message";
import { myId } from "./load-small";

/** Which files: the ones shown in the library, or the ones hidden from it (inline logos, tiny images, junk, your own choice). */
export type HiddenMode = "visible" | "hidden";

export type AttachmentPage = {
  files: FiledAttachment[];
  /** Where the next page starts, or null when this was the last. */
  next: Cursor | null;
  /** How many files match on the server; only on a first page, and null when it could not be counted. */
  total: number | null;
};

const COLUMNS = "id, filename, kind, size_bytes, storage_path, hidden_reason, sealed, not_kept, sent_at, messages!inner(id, thread_id, sent_at, direction, sender_contact_id, threads!inner(status))";
// Without sent_at (migration 20261117170000 not applied yet) the page still opens, on its newest files only.
const LEGACY_COLUMNS = COLUMNS.replace(" sent_at, messages", " messages") as typeof COLUMNS;
const LEGACY_LIMIT = 1000;

/**
 * The query for one tab and list. Voice notes and stickers belong to their chats and are left out; real audio files are in,
 * under the Audio tab only. Files in deleted conversations (in the provider's bin) are left out, as the conversations are.
 * Not async: a query builder is awaitable, so returning one from an async function would run it.
 */
function build<T extends string>(columns: T, userId: string, kind: Kind, mode: HiddenMode, opts?: { count: "exact"; head?: boolean }) {
  const query = supabase
    .from("attachments")
    .select(columns, opts)
    .eq("user_id", userId)
    .neq("messages.threads.status", "trash")
    .eq("is_sticker", false)
    .eq("hidden", mode === "hidden");
  return kind === "all" ? query.neq("kind", "audio") : query.eq("kind", kind);
}

/** One page of the library for a tab, after a cursor (the first page when there is none). */
export async function loadAttachmentPage(kind: Kind, mode: HiddenMode, after?: Cursor | null, limit = ATTACHMENT_PAGE): Promise<AttachmentPage> {
  const userId = await myId();
  const columns = await withSealedColumns(COLUMNS);
  const opts = after ? undefined : { count: "exact" as const };
  let legacy = false;
  let paged = build(columns, userId, kind, mode, opts).order("sent_at", { ascending: false }).order("id", { ascending: false }).limit(limit + 1);
  if (after) paged = paged.or(afterCursorFilter(after));
  let { data: sealedRows, error, count } = await paged;
  if (error?.code === "42703") {
    legacy = true;
    ({ data: sealedRows, error, count } = await build(await withSealedColumns(LEGACY_COLUMNS), userId, kind, mode, opts).order("created_at", { ascending: false }).limit(LEGACY_LIMIT));
  }
  if (error) throw error;
  const rows = await openAddresses(sealedRows);
  const files: FiledAttachment[] = (rows ?? []).flatMap(({ messages: m, ...a }) =>
    m
      ? [{
          ...mapAttachment(a),
          hiddenReason: (a.hidden_reason as Attachment["hiddenReason"]) ?? undefined,
          messageId: m.id,
          threadId: m.thread_id,
          sentAt: (a as { sent_at?: string | null }).sent_at ?? m.sent_at,
          from: m.direction === "outbound" ? "me" : m.sender_contact_id ?? "unknown",
        }]
      : [],
  );
  // One extra row was asked for: if it came back there is another page, and it is not shown.
  const more = !legacy && files.length > limit;
  const page = more ? files.slice(0, limit) : files;
  if (legacy) page.sort((a, b) => b.sentAt.localeCompare(a.sentAt));
  return { files: page, next: more ? cursorOf(page[page.length - 1]) : null, total: after ? null : count ?? null };
}

/** How many files a tab has in a list, without loading them. Null when the count is unavailable. */
export async function countAttachments(kind: Kind, mode: HiddenMode): Promise<number | null> {
  const { count, error } = await build("id, messages!inner(threads!inner(status))", await myId(), kind, mode, { count: "exact", head: true });
  return error ? null : count;
}

/** Hides or unhides files (your own choice, kept apart from the automatic reasons). Resolves false when it could not be saved. */
export async function setAttachmentsHidden(ids: string[], hidden: boolean): Promise<boolean> {
  const { error } = await supabase.rpc("set_attachment_hidden", { p_ids: ids, p_hidden: hidden });
  return !error;
}
