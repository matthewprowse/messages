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

// How long a browser keeps a stored object (Cache-Control max-age, seconds). The web app reuses a signed link for a day
// (apps/web/lib/signed-urls/links.ts), and its cached copy is keyed by that link, so:
/**
 * A path written again in place: contact and group photos and company icons (refreshed under the same name), team
 * copies (sealed again on key rotation, after which the old key is retired) and logo review files. An hour, so an old
 * photo or bytes nobody can open any more do not linger; after it the browser revalidates, a 304 when unchanged.
 */
export const REWRITTEN_CACHE_S = 60 * 60;
/** A path written once (an attachment or its thumbnail, by id; a meeting recording): a day, the life of a signed link. */
export const WRITE_ONCE_CACHE_S = 24 * 60 * 60;
/** A content-addressed path in a public bucket (chosen company logos): new content always gets a new name. A year. */
export const IMMUTABLE_CACHE_S = 365 * 24 * 60 * 60;

/** Uploads (or replaces) one object, cached by browsers for cacheSeconds. Throws an error whose code is STORAGE or STORAGE_<status>. */
export async function uploadObject(bucket: string, path: string, bytes: Buffer, contentType: string, cacheSeconds = REWRITTEN_CACHE_S): Promise<void> {
  const { error } = await db.storage.from(bucket).upload(path, bytes, { contentType, upsert: true, cacheControl: String(cacheSeconds) });
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
