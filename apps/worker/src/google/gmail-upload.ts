import { randomBytes } from "node:crypto";
import type { RawBody } from "./client";

// Gmail's JSON send endpoint carries the email base64 encoded inside JSON, which is too small for
// attachments. The upload endpoint takes the email's own bytes. A reply also needs its Gmail
// conversation ID, which only a multipart upload can carry next to the bytes.

export const GMAIL_UPLOAD_SEND = "https://gmail.googleapis.com/upload/gmail/v1/users/me/messages/send";

/** Uploads can be large and slow; allow far longer than an ordinary API call. */
export const UPLOAD_TIMEOUT_MS = 5 * 60_000;

/** A boundary that does not occur in the email, so the parts cannot be confused. */
function boundaryFor(raw: Buffer): string {
  for (;;) {
    const boundary = `messages_${randomBytes(16).toString("hex")}`;
    if (!raw.includes(boundary)) return boundary;
  }
}

/**
 * The upload request for one email: the bytes alone ("media") for a new email, or the Gmail
 * conversation ID and the bytes together ("multipart") for a reply.
 */
export function gmailUploadRequest(raw: Buffer, threadId?: string): { uploadType: "media" | "multipart"; body: RawBody } {
  if (!threadId) return { uploadType: "media", body: { contentType: "message/rfc822", data: raw } };
  const boundary = boundaryFor(raw);
  const head = Buffer.from(
    `--${boundary}\r\n` +
      `Content-Type: application/json; charset=UTF-8\r\n\r\n` +
      `${JSON.stringify({ threadId })}\r\n` +
      `--${boundary}\r\n` +
      `Content-Type: message/rfc822\r\n\r\n`,
  );
  const tail = Buffer.from(`\r\n--${boundary}--\r\n`);
  return { uploadType: "multipart", body: { contentType: `multipart/related; boundary=${boundary}`, data: Buffer.concat([head, raw, tail]) } };
}
