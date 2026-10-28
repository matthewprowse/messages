// Attachment files live in the private "attachments" bucket at <user id>/<message id>/<attachment id>, sealed
// with the user's data key (file-store.ts). The bucket's read policy lets a signed-in user read only paths under
// their own user ID. Whether a file is copied at all (video limit, seat cap, one copy per account) is decided
// in file-store.ts and storage-rules.ts.

import { FIELD } from "@messages/crypto/fields";
import { db, must } from "../db";
import { keepFile, MAX_FILE_BYTES } from "../file-store";
import { errorCode, log } from "../log";
import { isDeferred, isVideoLink, refusing, stateFor } from "../storage-rules";
import { open } from "../vault";
import { fileHints } from "./file-hints";
import type { EmailAttachment } from "./normalize-email";

export { MAX_FILE_BYTES };

/** Hidden files that are not worth a stored copy. The original stays in the mailbox. */
const NOT_STORED = new Set(["tiny", "junk"]);

/**
 * Uploads the files of one stored message and records where each one went. Rows are matched to the
 * parsed files by name and size, since the database row does not keep the MIME part (the stored name is
 * encrypted, so it is opened to compare). Logos, signature images and tracking pixels are marked hidden on the
 * way (a manual choice is never changed), and tiny or junk files are not uploaded. Returns how many files were
 * saved. Files already saved, too large, over the video or storage limits, or without a match are skipped.
 * A file over the eager size, or on an old message, is not copied: its row is marked not_kept = 'deferred' and the
 * file is fetched when its owner opens it. `wanted` names the rows to copy now whatever their size or age (a
 * request to open one), and then every other row is left alone.
 */
export async function saveAttachmentFiles(
  accountId: string,
  userId: string,
  messageId: string,
  files: EmailAttachment[],
  opts: { wanted?: ReadonlySet<string> } = {},
): Promise<number> {
  if (files.length === 0) return 0;
  const sentAt = opts.wanted ? null : (await db.from("messages").select("sent_at").eq("id", messageId).maybeSingle()).data?.sent_at ?? null;
  const rows = must(
    await db
      .from("attachments")
      .select("id, filename, kind, size_bytes, storage_path, hidden_reason, file_ext, keep_hint, is_sticker")
      .eq("message_id", messageId)
      .order("id"),
    "load attachment rows",
  );
  const unused = [...files];
  let saved = 0;
  let started = rows.some((r) => r.storage_path);
  for (const row of rows) {
    if (opts.wanted && !opts.wanted.has(row.id)) continue;
    const name = await open(userId, FIELD.filename, row.filename);
    const i = unused.findIndex((f) => f.filename === name && f.sizeBytes === row.size_bytes);
    if (i < 0) continue;
    const [file] = unused.splice(i, 1);

    let reason = row.hidden_reason;
    // The database cannot read the name, so it is told the little it needs. This re-works the junk mark.
    const hints = fileHints(file.filename);
    if (row.file_ext !== hints.ext || row.keep_hint !== hints.keep || row.is_sticker !== hints.sticker) {
      const updated = must(
        await db.from("attachments").update({ file_ext: hints.ext, keep_hint: hints.keep, is_sticker: hints.sticker }).eq("id", row.id).select("hidden_reason").single(),
        "save attachment hints",
      );
      reason = updated.hidden_reason;
    }
    if (file.hiddenReason && (reason === null || reason === "junk")) {
      reason = file.hiddenReason;
      must(await db.from("attachments").update({ hidden: true, hidden_reason: reason }).eq("id", row.id), "hide attachment");
    }
    if (row.storage_path || (reason && NOT_STORED.has(reason))) continue;

    // Left at the provider until opened. If the database does not know 'deferred' yet (migration pending), the file is
    // copied as before rather than lost.
    if (!opts.wanted && !hints.sticker && isDeferred(row.size_bytes, sentAt)) {
      const { error } = await db.from("attachments").update({ not_kept: "deferred" }).eq("id", row.id).is("storage_path", null);
      if (!error) continue;
    }

    const result = await keepFile({
      userId,
      accountId,
      messageId,
      attachmentId: row.id,
      kind: row.kind,
      mimeType: file.mimeType,
      bytes: file.content,
      messageStarted: started,
    });
    if (result.saved) {
      saved++;
      started = true;
    }
  }
  return saved;
}

/** Saves one message's files, logging (not throwing) a failure so the catch-up pass can try again later. */
export async function saveFilesQuietly(accountId: string, userId: string, messageId: string, files: EmailAttachment[]): Promise<number> {
  if (files.length === 0) return 0;
  try {
    return await saveAttachmentFiles(accountId, userId, messageId, files);
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
      .select("id, user_id, kind, size_bytes, message_id, messages!inner(account_id, provider_meta)")
      .is("storage_path", null)
      .eq("hidden", false)
      .eq("messages.account_id", this.accountId)
      .lte("size_bytes", MAX_FILE_BYTES)
      // A video kept as a link is never fetched; a file refused for a full seat is tried again once there is room.
      // A deferred file ('deferred') is left out on purpose: it is fetched only when its owner opens it (fetch-requests.ts).
      .or("not_kept.is.null,not_kept.eq.over_cap");
    if (this.cursor) query = query.gt("id", this.cursor);
    const rows = must(await query.order("id").limit(this.pageSize), "load missing attachment files");
    this.cursor = rows.length < this.pageSize ? null : rows[rows.length - 1].id;
    const todo = rows.filter((r) => !this.tried.has(r.id));
    for (const r of todo) this.tried.add(r.id);

    // Decided from the row alone, before anything is downloaded: a big video is marked, and nothing is fetched for
    // someone whose storage is full.
    const wanted: typeof todo = [];
    for (const r of todo) {
      if (isVideoLink(r.kind, r.size_bytes)) {
        must(await db.from("attachments").update({ not_kept: "video_link" }).eq("id", r.id), "mark attachment not kept");
      } else if (!refusing(await stateFor(r.user_id))) {
        wanted.push(r);
      }
    }
    return wanted.map((r) => ({ id: r.id, message_id: r.message_id, provider_meta: r.messages.provider_meta }));
  }
}
