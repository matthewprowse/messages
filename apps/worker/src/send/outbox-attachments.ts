// Files sent with an outbox row. The app seals each file with the user's key and uploads it to the private
// "attachments" bucket at "<user id>/outbox/<uuid>/file", inserts the outbox row with attachment_count, then adds one
// outbox_attachments row per file with its name sealed. The worker waits for those rows before it claims the outbox
// row (the app can add them only while the row is still queued), and opens the bytes and names just before sending,
// strictly: each must have been sealed for its own path and row (attachment-rules.ts). Files uploaded plain under their
// own name, before sealing began, are read only while encryption is off.

import { db, must } from "../db";
import { sleep } from "../backoff";
import { ATTACHMENTS_BUCKET, storageError, storageStatus } from "../storage";
import type { OutgoingAttachment } from "./compose";
import { keysFor } from "../vault";
import { env } from "../env";
import {
  ATTACHMENT_WAIT_MS,
  ATTACHMENTS_CHANGED,
  ATTACHMENTS_MISSING,
  ATTACHMENTS_UNREADABLE,
  NOT_UPLOADED,
  attachmentProgress,
  leastPlainBytes,
  limitError,
  openOutboxFile,
  openOutboxName,
  ownOutboxPath,
  safeFilename,
  safeMimeType,
  storageUrlPath,
  type AttachmentProvider,
} from "./attachment-rules";

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

  // The sizes the app recorded can be wrong, so the stored sizes are checked before anything is downloaded. A sealed
  // object carries a few bytes more than its file, so only what it surely holds is counted here.
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
  const real = limitError(provider, (stored as number[]).map(leastPlainBytes));
  if (real) return { error: real };

  // Downloaded together: the total is already within the provider's limit.
  const keys = () => keysFor(row.user_id);
  const rule = { sealed: env.encryptContent, legacy: !env.requireBoundFields };
  const downloaded = await Promise.all(
    rows.map(async (a): Promise<OutgoingAttachment | { error: string }> => {
      const { data, error } = await db.storage.from(ATTACHMENTS_BUCKET).download(storageUrlPath(a.storage_path));
      if (error || !data) return storageFailure(error);
      const opened = await openOutboxFile(new Uint8Array(await data.arrayBuffer()), keys, a.storage_path, rule);
      const filename = await openOutboxName(a.filename, keys, row.id, a.storage_path, rule);
      if (!opened || filename === null) return { error: ATTACHMENTS_UNREADABLE };
      const content = Buffer.from(opened.buffer, opened.byteOffset, opened.byteLength);
      if (content.length === 0) return { error: ATTACHMENTS_MISSING };
      const file: OutgoingAttachment = { filename: safeFilename(filename), contentType: safeMimeType(a.mime_type), content };
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
