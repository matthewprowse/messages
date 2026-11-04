// Files attached to a message you send. Each is sealed in the browser (sealOutboxBytes, bound to its path) and uploaded
// to the private "attachments" bucket first, at "<user id>/outbox/<uuid>/file" (no real name in the path), then the outbox
// row is queued with attachment_count, then one outbox_attachments row is added per file with its name sealed for that
// row and file (outbox-places.ts). The worker
// opens and sends once it sees every file. This module has no Supabase import so its helpers can be unit tested.

import { SEALED_OVERHEAD_BYTES } from "@messages/crypto";
import { FIELD, type Field } from "@messages/crypto/fields";
import type { Attachment, Provider } from "./types";

export const BUCKET = "attachments";
export const MAX_FILES = 10;
const MB = 1024 * 1024;

export type AttachProvider = "icloud" | "gmail" | "outlook" | "whatsapp" | "imap" | "linkedin" | "instagram";

/** What each service accepts. Email limits cover every file together; WhatsApp limits each file. */
export const OUTBOX_LIMITS: Record<AttachProvider, { totalBytes?: number; perFileBytes?: number; message: string }> = {
  icloud: { totalBytes: 20 * MB, message: "iCloud Mail allows up to 20 MB per email. Attachments grow by about a third when sent." },
  gmail: { totalBytes: 25 * MB, message: "Gmail allows up to 25 MB per email. Attachments grow by about a third when sent." },
  outlook: { totalBytes: 20 * MB, message: "Outlook allows up to 20 MB per email. Attachments grow by about a third when sent." },
  // WhatsApp itself takes 100 MB, but uploads go through Supabase Storage, whose Free plan stops at 50 MB, and the
  // sealed upload is a few bytes larger than the file.
  whatsapp: { perFileBytes: 50 * MB - SEALED_OVERHEAD_BYTES, message: "WhatsApp files can be up to 50 MB each here." },
  linkedin: { perFileBytes: 20 * MB, message: "LinkedIn files can be up to 20 MB each here." },
  // Instagram direct messages take photos and videos only; the worker says so for any other file.
  instagram: { perFileBytes: 25 * MB, message: "Instagram photos and videos can be up to 25 MB each here." },
  // Any other mailbox: each host sets its own limit, and 20 MB of files fits the common ones.
  imap: { totalBytes: 20 * MB, message: "Your mail server allows up to 20 MB per email. Attachments grow by about a third when sent." },
};

/**
 * The service files are sent through, or null when this kind of conversation cannot carry files.
 */
export function attachProvider(p: Provider | undefined): AttachProvider | null {
  return p === "icloud" || p === "gmail" || p === "outlook" || p === "whatsapp" || p === "imap" || p === "linkedin" || p === "instagram" ? p : null;
}

/** Why these files cannot be sent through this service, or null when they can. */
export function limitError(provider: AttachProvider, files: { name: string; size: number }[]): string | null {
  if (files.length > MAX_FILES) return `Attach up to ${MAX_FILES} files per message.`;
  const empty = files.find((f) => f.size <= 0);
  if (empty) return `${displayName(empty.name)} is empty.`;
  const limit = OUTBOX_LIMITS[provider];
  if (limit.perFileBytes !== undefined && files.some((f) => f.size > limit.perFileBytes!)) return limit.message;
  if (limit.totalBytes !== undefined && files.length > 0 && encodedEmailBytes(files.map((f) => f.size)) > limit.totalBytes) return limit.message;
  return null;
}

/**
 * About how large these files make an email. Providers measure the whole message, and base64 makes each
 * file a third larger, plus line breaks and part headers; the allowance covers the headers and text.
 * The worker uses the same estimate (apps/worker/src/send/attachment-rules.ts).
 */
export function encodedEmailBytes(sizes: number[]): number {
  return sizes.reduce((sum, n) => sum + Math.ceil(Math.ceil(n / 3) * 4 * (78 / 76)) + 1024, 64 * 1024);
}

function splitExtension(name: string): [string, string] {
  const dot = name.lastIndexOf(".");
  return dot > 0 && name.length - dot <= 12 ? [name.slice(0, dot), name.slice(dot)] : [name, ""];
}

/** Cuts a name to max characters, keeping its extension. */
function capLength(name: string, max: number): string {
  if (name.length <= max) return name;
  const [stem, ext] = splitExtension(name);
  return stem.slice(0, Math.max(1, max - ext.length)).trimEnd() + ext;
}

/**
 * The name the recipient sees: control characters and path separators removed, spaces tidied, at most
 * 255 characters with the extension kept.
 */
export function displayName(name: string): string {
  const clean = name
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .replace(/[/\\]/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^\.+/, "");
  return capLength(clean, 255) || "Attachment";
}

/** The object name every outbox upload has. The real name is sealed in outbox_attachments.filename, never in the path. */
export const OUTBOX_OBJECT_NAME = "file";

/** "<user id>/outbox/<file id>/file", the only form the storage and table policies allow for a new upload. */
export function outboxPath(userId: string, fileId: string): string {
  return `${userId}/outbox/${fileId}/${OUTBOX_OBJECT_NAME}`;
}

/** Seals a file's bytes for one field: lib/vault.ts sealBytesWith with the user's keys and the file's place, or a test's. */
export type BytesSealer = (field: Field, bytes: Uint8Array<ArrayBuffer>) => Promise<Uint8Array<ArrayBuffer>>;

/**
 * A file's bytes sealed with the user's key (FIELD.outboxFileData, bound to its storage path once bound values are on),
 * as the opaque blob that is uploaded. Always sealed, like note files: the worker refuses a plain upload while
 * encryption is on.
 */
export async function sealOutboxBytes(file: Blob, seal: BytesSealer): Promise<Blob> {
  const sealed = await seal(FIELD.outboxFileData, new Uint8Array(await file.arrayBuffer()));
  return new Blob([sealed], { type: "application/octet-stream" });
}

/** The upload address for a path, each segment encoded. */
export function uploadUrl(base: string, path: string): string {
  return `${base.replace(/\/+$/, "")}/storage/v1/object/${BUCKET}/${path.split("/").map(encodeURIComponent).join("/")}`;
}

const MIME_BY_EXTENSION: Record<string, string> = {
  pdf: "application/pdf",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  heic: "image/heic",
  heif: "image/heif",
  svg: "image/svg+xml",
  mp4: "video/mp4",
  mov: "video/quicktime",
  mp3: "audio/mpeg",
  m4a: "audio/mp4",
  wav: "audio/wav",
  txt: "text/plain",
  csv: "text/csv",
  ics: "text/calendar",
  zip: "application/zip",
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xls: "application/vnd.ms-excel",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ppt: "application/vnd.ms-powerpoint",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  pages: "application/vnd.apple.pages",
  numbers: "application/vnd.apple.numbers",
  key: "application/vnd.apple.keynote",
};

/** The browser's own type when it gives one, otherwise a guess from the extension. */
export function mimeOf(name: string, type: string): string {
  // Only the "type/subtype" part, so no parameters ride along into the upload or the email's headers.
  const essence = /^[\w.+-]+\/[\w.+-]+/.exec(type.trim())?.[0];
  if (essence) return essence.toLowerCase();
  const ext = splitExtension(name)[1].slice(1).toLowerCase();
  return MIME_BY_EXTENSION[ext] ?? "application/octet-stream";
}

export function kindOf(mime: string): Attachment["kind"] {
  if (mime.startsWith("image/")) return "image";
  if (mime.startsWith("video/")) return "video";
  if (mime.startsWith("audio/")) return "audio";
  if (mime === "application/pdf") return "pdf";
  return "file";
}

/** A name not already in use: "Pasted Image.png", then "Pasted Image 2.png", and so on. */
export function uniqueName(name: string, taken: string[]): string {
  const used = new Set(taken.map((t) => t.toLowerCase()));
  if (!used.has(name.toLowerCase())) return name;
  const [stem, ext] = splitExtension(name);
  for (let i = 2; ; i++) {
    const next = `${stem} ${i}${ext}`;
    if (!used.has(next.toLowerCase())) return next;
  }
}

/** Pasted screenshots arrive as "image.png"; they are given a clearer name. */
export function pastedName(type: string, taken: string[]): string {
  const sub = type.split("/")[1]?.split(/[+;]/)[0]?.toLowerCase() || "png";
  return uniqueName(`Pasted Image.${sub === "jpeg" ? "jpg" : sub}`, taken);
}

/**
 * Take files from a paste only when the clipboard holds no plain text, so copying formatted text (which
 * some apps also put on the clipboard as a picture) still pastes as text.
 */
export function shouldTakePastedFiles(types: readonly string[], fileCount: number): boolean {
  return fileCount > 0 && !types.includes("text/plain");
}

/** A file uploaded and ready to be listed on an outbox row. */
export interface OutboxUpload {
  path: string;
  /** The name as the recipient sees it: plain here, sealed only in the row written (app-store/compose.ts). */
  filename: string;
  mimeType: string;
  size: number;
  /** Recorded in the reply box, so WhatsApp sends it as a voice note rather than an audio file. */
  voiceNote?: boolean;
}

/** The attachment tiles an optimistic sent bubble shows, read from the files already uploaded (sealed, so opened in the browser). */
export function pendingAttachments(files: OutboxUpload[]): Attachment[] {
  return files.map((f) => ({ id: `outbox:${f.path}`, name: f.filename, kind: kindOf(f.mimeType), size: formatBytes(f.size), path: f.path, sealed: true }));
}

/** The outbox_attachments rows for an outbox row, in the order the files were added. */
export function attachmentRows(outboxId: string, files: OutboxUpload[]) {
  return files.map((f, position) => ({ outbox_id: outboxId, storage_path: f.path, filename: f.filename, mime_type: f.mimeType, size_bytes: f.size, position, voice_note: !!f.voiceNote }));
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < MB) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / MB).toFixed(1)} MB`;
}

export class UploadError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

/**
 * Uploads one file straight to Supabase Storage with XMLHttpRequest, which (unlike fetch) reports upload
 * progress. It never overwrites: the path is new each time and there is no update policy.
 */
export function uploadFile(opts: {
  base: string;
  apiKey: string;
  token: string;
  path: string;
  file: Blob;
  mimeType: string;
  onProgress?: (fraction: number) => void;
}): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", uploadUrl(opts.base, opts.path));
    xhr.setRequestHeader("authorization", `Bearer ${opts.token}`);
    xhr.setRequestHeader("apikey", opts.apiKey);
    xhr.setRequestHeader("content-type", opts.mimeType);
    xhr.setRequestHeader("cache-control", "max-age=3600");
    xhr.setRequestHeader("x-upsert", "false");
    xhr.upload.onprogress = (e) => { if (e.lengthComputable && e.total > 0) opts.onProgress?.(e.loaded / e.total); };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) { opts.onProgress?.(1); resolve(); }
      else {
        const status = uploadStatus(xhr.status, xhr.responseText);
        reject(new UploadError(status, uploadMessage(status)));
      }
    };
    xhr.onerror = () => reject(new UploadError(0, uploadMessage(0)));
    xhr.send(opts.file);
  });
}

/** Storage answers most failures with HTTP 400 and puts the real code in the body, as statusCode. */
export function uploadStatus(httpStatus: number, body: string): number {
  try {
    const code = Number((JSON.parse(body) as { statusCode?: unknown }).statusCode);
    if (Number.isInteger(code) && code >= 400) return code;
  } catch {
    // not JSON
  }
  return httpStatus;
}

/** What to show on a file whose upload failed. */
export function uploadMessage(status: number): string {
  if (status === 413) return "Too Large to Upload";
  if (status === 401) return "Sign In Again to Upload";
  if (status === 403) return "Upload Not Allowed";
  if (status === 0) return "Upload Failed. Check Your Connection.";
  return "Upload Failed";
}
