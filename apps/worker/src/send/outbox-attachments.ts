// Files sent with an outbox row. The app uploads them to the private "attachments" bucket at
// "<user id>/outbox/<uuid>/<filename>", inserts the outbox row with attachment_count, then adds one
// outbox_attachments row per file. The worker waits for those rows before it claims the outbox row:
// the app can add them only while the row is still queued.

import { db, must } from "../db";
import { log, errorCode } from "../log";
import { sleep, startEvery } from "../backoff";
import { ATTACHMENTS_BUCKET, storageError, storageStatus } from "../storage";
import type { OutgoingAttachment } from "./compose";
import {
  ATTACHMENT_WAIT_MS,
  ATTACHMENTS_CHANGED,
  ATTACHMENTS_MISSING,
  NOT_UPLOADED,
  attachmentProgress,
  limitError,
  ownOutboxPath,
  safeFilename,
  safeMimeType,
  storageUrlPath,
  type AttachmentProvider,
} from "./attachment-rules";
import { removableOutboxPath } from "./cleanup-rules";

const POLL_MS = 1_000;

interface OutboxFiles {
  id: string;
  user_id: string;
  attachment_count: number;
}

async function countAttachments(outboxId: string): Promise<number> {
  const { count, error } = await db.from("outbox_attachments").select("id", { count: "exact", head: true }).eq("outbox_id", outboxId);
  if (error) throw Object.assign(new Error("count outbox attachments failed"), { code: error.code });
  return count ?? 0;
}

/**
 * Waits until the app has added every file row for this outbox row, up to a minute. Returns null when
 * they are all there, or the reason to fail the row with.
 */
export async function waitForAttachments(row: OutboxFiles, waitMs = ATTACHMENT_WAIT_MS): Promise<string | null> {
  if (row.attachment_count <= 0) return null;
  const deadline = Date.now() + waitMs;
  for (;;) {
    const progress = attachmentProgress(row.attachment_count, await countAttachments(row.id));
    if (progress === "ready") return null;
    if (progress === "too_many") return ATTACHMENTS_CHANGED;
    if (Date.now() >= deadline) return NOT_UPLOADED;
    await sleep(POLL_MS);
  }
}

/** A missing file fails the row; a storage outage throws, so the row fails with "Try again". */
function storageFailure(error: unknown): { error: string } {
  const status = storageStatus(error);
  if (status === 400 || status === 404) return { error: ATTACHMENTS_MISSING };
  throw storageError("read outbox attachment", error);
}

/**
 * The files of a claimed outbox row, in the order they were added, checked against the provider's
 * limits before and after downloading. Returns the reason to fail the row with when they cannot go.
 * A storage outage throws, so the row fails with "Try again".
 */
export async function loadAttachmentFiles(row: OutboxFiles, provider: AttachmentProvider): Promise<OutgoingAttachment[] | { error: string }> {
  const rows = must(
    await db
      .from("outbox_attachments")
      .select("id, user_id, storage_path, filename, mime_type, size_bytes, position, voice_note")
      .eq("outbox_id", row.id)
      .order("position")
      .order("created_at")
      .limit(row.attachment_count + 1),
    "load outbox attachments",
  );
  if (rows.length > row.attachment_count) return { error: ATTACHMENTS_CHANGED };
  if (rows.length < row.attachment_count) return { error: NOT_UPLOADED };
  if (rows.length === 0) return [];
  if (rows.some((a) => a.user_id !== row.user_id || !ownOutboxPath(row.user_id, a.storage_path))) return { error: ATTACHMENTS_MISSING };

  const declared = limitError(provider, rows.map((a) => a.size_bytes));
  if (declared) return { error: declared };

  // The sizes the app recorded can be wrong, so the stored sizes are checked before anything is downloaded.
  const stored = await Promise.all(
    rows.map(async (a): Promise<number | { error: string }> => {
      const { data, error } = await db.storage.from(ATTACHMENTS_BUCKET).info(storageUrlPath(a.storage_path));
      if (error || !data) return storageFailure(error);
      if (typeof data.size !== "number" || data.size <= 0) return { error: ATTACHMENTS_MISSING };
      return data.size;
    }),
  );
  const unreadable = stored.find((s): s is { error: string } => typeof s !== "number");
  if (unreadable) return unreadable;
  const real = limitError(provider, stored as number[]);
  if (real) return { error: real };

  // Downloaded together: the total is already within the provider's limit.
  const downloaded = await Promise.all(
    rows.map(async (a): Promise<OutgoingAttachment | { error: string }> => {
      const { data, error } = await db.storage.from(ATTACHMENTS_BUCKET).download(storageUrlPath(a.storage_path));
      if (error || !data) return storageFailure(error);
      const content = Buffer.from(await data.arrayBuffer());
      if (content.length === 0) return { error: ATTACHMENTS_MISSING };
      const file: OutgoingAttachment = { filename: safeFilename(a.filename), contentType: safeMimeType(a.mime_type), content };
      if (a.voice_note === true && provider === "whatsapp") file.voiceNote = true;
      return file;
    }),
  );
  const missing = downloaded.find((f): f is { error: string } => "error" in f);
  if (missing) return missing;
  const files = downloaded as OutgoingAttachment[];
  // The stored files are what goes out, whatever sizes the app recorded.
  const actual = limitError(provider, files.map((f) => f.content.length));
  if (actual) return { error: actual };
  return files;
}

/** Sends with files hold every file in memory, more than once; only a few run at a time. */
const FILE_SENDS_AT_ONCE = 2;
let fileSends = 0;
const waitingForSlot: (() => void)[] = [];

/** Runs a send, waiting first for a free slot when the row has files. Rows without files run at once. */
export async function withAttachmentSlot<T>(row: { attachment_count: number }, run: () => Promise<T>): Promise<T> {
  if (!(row.attachment_count > 0)) return run();
  while (fileSends >= FILE_SENDS_AT_ONCE) await new Promise<void>((resolve) => waitingForSlot.push(resolve));
  fileSends++;
  try {
    return await run();
  } finally {
    fileSends--;
    waitingForSlot.shift()?.();
  }
}

const KEEP_MS = 7 * 24 * 60 * 60 * 1000;
const CLEANUP_EVERY_MS = 24 * 60 * 60 * 1000;
const CLEANUP_FIRST_MS = 60_000;
const CLEANUP_BATCH = 100;

/**
 * Removes the uploaded files of sent or failed outbox rows whose file was added more than a week ago
 * (filtered on the attachment's created_at), with their file rows. A sent email keeps its own stored
 * copy of each file. Returns how many files were removed.
 */
async function cleanupOutboxFiles(): Promise<number> {
  const cutoff = new Date(Date.now() - KEEP_MS).toISOString();
  let removed = 0;
  // Rows whose path is not ours to remove are left alone (rows and object both) and left out of the next read, so the loop ends.
  const skipped: string[] = [];
  for (;;) {
    let query = db
      .from("outbox_attachments")
      .select("id, user_id, storage_path, outbox!inner(status)")
      .lt("created_at", cutoff)
      .in("outbox.status", ["sent", "failed"]);
    if (skipped.length) query = query.not("id", "in", `(${skipped.join(",")})`);
    const rows = must(await query.limit(CLEANUP_BATCH), "load old outbox attachments");
    if (rows.length === 0) break;
    const ours = rows.filter((r) => removableOutboxPath(r.user_id, r.storage_path));
    for (const r of rows) if (!ours.includes(r)) skipped.push(r.id);
    if (ours.length < rows.length) log.warn("outbox files left in place", { skipped: skipped.length });
    if (ours.length) {
      const { error } = await db.storage.from(ATTACHMENTS_BUCKET).remove(ours.map((r) => r.storage_path));
      if (error) throw storageError("remove outbox files", error);
      must(await db.from("outbox_attachments").delete().in("id", ours.map((r) => r.id)), "delete old outbox attachments");
      removed += ours.length;
    }
    if (rows.length < CLEANUP_BATCH) break;
  }
  return removed;
}

/** Runs the cleanup a minute after startup, then once a day. */
export function startOutboxCleanup() {
  startEvery(
    CLEANUP_FIRST_MS,
    CLEANUP_EVERY_MS,
    async () => {
      const removed = await cleanupOutboxFiles();
      if (removed > 0) log.info("outbox files removed", { removed });
    },
    (err) => log.warn("outbox cleanup failed", { code: errorCode(err) }),
  );
}
