// Files the worker keeps in Supabase Storage: attachments and avatars. One list of what a browser may
// show inline, and one way to upload and to describe a storage failure.

import { db } from "./db";

// Types a browser can show without running anything. Everything else is stored as a plain download.
const INLINE_TYPES = /^(image\/(png|jpe?g|gif|webp|heic|heif|avif|bmp)|application\/pdf|video\/(mp4|quicktime|webm|3gpp)|audio\/[\w.+-]+|text\/plain)$/i;

/** The Content-Type to store a file with: its own type (without parameters) when safe to show, else a download. */
export function storedType(mimeType: string | null | undefined): string {
  const type = (mimeType ?? "").split(";")[0].trim().toLowerCase();
  return INLINE_TYPES.test(type) ? type : "application/octet-stream";
}

/** The HTTP status a storage error carries, when it carries one. */
export function storageStatus(error: unknown): number | undefined {
  const e = error as { status?: unknown; statusCode?: unknown } | null;
  const status = Number(e?.status ?? e?.statusCode);
  return Number.isFinite(status) ? status : undefined;
}

/** Uploads (or replaces) one object. Throws an error whose code is STORAGE or STORAGE_<status>. */
export async function uploadObject(bucket: string, path: string, bytes: Buffer, contentType: string): Promise<void> {
  const { error } = await db.storage.from(bucket).upload(path, bytes, { contentType, upsert: true });
  if (error) throw storageError("storage upload", error);
}

/** An error for a storage failure, coded STORAGE or STORAGE_<status>. */
export function storageError(what: string, error: unknown): Error {
  const status = storageStatus(error);
  return Object.assign(new Error(`${what} failed`), { code: status ? `STORAGE_${status}` : "STORAGE" });
}

/** The private bucket for email and WhatsApp attachments, and files queued with outgoing messages. */
export const ATTACHMENTS_BUCKET = "attachments";

/** Where a received attachment is stored: <user id>/<message id>/<attachment id>. */
export function attachmentPath(userId: string, messageId: string, attachmentId: string) {
  return `${userId}/${messageId}/${attachmentId}`;
}
