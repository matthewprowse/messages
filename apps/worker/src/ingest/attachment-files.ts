import { db, must } from "../db";
import { errorCode, log } from "../log";
import { ATTACHMENTS_BUCKET, attachmentPath, storedType, uploadObject } from "../storage";
import type { EmailAttachment } from "./normalize-email";

// Attachment files live in the private "attachments" bucket at <user id>/<message id>/<attachment id>.
// The bucket's read policy lets a signed-in user read only paths under their own user ID.

export const MAX_FILE_BYTES = 50 * 1024 * 1024; // Supabase's default upload limit

/** Hidden files that are not worth a stored copy. The original stays in the mailbox. */
const NOT_STORED = new Set(["tiny", "junk"]);

/**
 * Uploads the files of one stored message and records where each one went. Rows are matched to the
 * parsed files by name and size, since the database row does not keep the MIME part. Logos, signature
 * images and tracking pixels are marked hidden on the way (a manual choice is never changed), and tiny
 * or junk files are not uploaded. Returns how many files were saved. Files already saved, too large,
 * or without a match are skipped.
 */
export async function saveAttachmentFiles(userId: string, messageId: string, files: EmailAttachment[]): Promise<number> {
  if (files.length === 0) return 0;
  const rows = must(
    await db.from("attachments").select("id, filename, size_bytes, storage_path, hidden_reason").eq("message_id", messageId).order("id"),
    "load attachment rows",
  );
  const unused = [...files];
  let saved = 0;
  for (const row of rows) {
    const i = unused.findIndex((f) => f.filename === row.filename && f.sizeBytes === row.size_bytes);
    if (i < 0) continue;
    const [file] = unused.splice(i, 1);

    let reason = row.hidden_reason;
    if (file.hiddenReason && (reason === null || reason === "junk")) {
      reason = file.hiddenReason;
      must(await db.from("attachments").update({ hidden: true, hidden_reason: reason }).eq("id", row.id), "hide attachment");
    }
    if (row.storage_path || (reason && NOT_STORED.has(reason)) || file.content.length > MAX_FILE_BYTES) continue;

    const path = attachmentPath(userId, messageId, row.id);
    await uploadObject(ATTACHMENTS_BUCKET, path, file.content, storedType(file.mimeType));
    must(await db.from("attachments").update({ storage_path: path }).eq("id", row.id), "save attachment path");
    saved++;
  }
  return saved;
}

/** Saves one message's files, logging (not throwing) a failure so the catch-up pass can try again later. */
export async function saveFilesQuietly(accountId: string, userId: string, messageId: string, files: EmailAttachment[]): Promise<number> {
  if (files.length === 0) return 0;
  try {
    return await saveAttachmentFiles(userId, messageId, files);
  } catch (err) {
    log.warn("attachment upload failed", { account: accountId, code: errorCode(err) });
    return 0;
  }
}

/**
 * Pages through an account's attachments that have no stored file yet, a page per call, starting over
 * after the last page. Rows already tried this run are left out, so a file that cannot be fetched never
 * blocks the ones after it.
 */
export class MissingFiles {
  private cursor: string | null = null;
  private readonly tried = new Set<string>();

  constructor(private readonly accountId: string, private readonly pageSize = 200) {}

  async next(): Promise<{ id: string; message_id: string; provider_meta: unknown }[]> {
    let query = db
      .from("attachments")
      .select("id, message_id, messages!inner(account_id, provider_meta)")
      .is("storage_path", null)
      .eq("hidden", false)
      .eq("messages.account_id", this.accountId)
      .lte("size_bytes", MAX_FILE_BYTES);
    if (this.cursor) query = query.gt("id", this.cursor);
    const rows = must(await query.order("id").limit(this.pageSize), "load missing attachment files");
    this.cursor = rows.length < this.pageSize ? null : rows[rows.length - 1].id;
    const todo = rows.filter((r) => !this.tried.has(r.id));
    for (const r of todo) this.tried.add(r.id);
    return todo.map((r) => ({ id: r.id, message_id: r.message_id, provider_meta: r.messages.provider_meta }));
  }
}
