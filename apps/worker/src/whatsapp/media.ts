import { downloadMediaMessage, type proto, type WAMessage, type WASocket } from "baileys";
import { db, must } from "../db";
import { ATTACHMENTS_BUCKET, attachmentPath, storedType, uploadObject } from "../storage";
import { MAX_FILE_BYTES } from "../ingest/attachment-files";
import type { MediaType } from "./normalize";
import { silentLogger } from "./logger";

// WhatsApp photos, voice notes, videos and documents, saved to the private "attachments" bucket at
// <user id>/<message id>/<attachment id>, the same layout as email attachments.

/**
 * What is needed to fetch a file again later: WhatsApp's encrypted copy, its key, and the message key so
 * the phone can be asked to upload it again once the link has expired. Kept in messages.provider_meta.
 */
export interface StoredMedia {
  type: MediaType;
  url: string | null;
  direct_path: string | null;
  media_key: string | null;
  file_enc_sha256: string | null;
  file_sha256: string | null;
  mimetype: string | null;
}

const b64 = (v: Uint8Array | null | undefined) => (v ? Buffer.from(v).toString("base64") : null);
const bytes = (v: string | null) => (v ? Buffer.from(v, "base64") : undefined);

export function mediaRef(type: MediaType, m: proto.Message.IImageMessage & proto.Message.IDocumentMessage): StoredMedia {
  return {
    type,
    url: m.url ?? null,
    direct_path: m.directPath ?? null,
    media_key: b64(m.mediaKey),
    file_enc_sha256: b64(m.fileEncSha256),
    file_sha256: b64(m.fileSha256),
    mimetype: m.mimetype ?? null,
  };
}

/** A minimal message Baileys can download from (and ask the phone to re-upload) using a stored reference. */
export function messageFromRef(key: proto.IMessageKey, media: StoredMedia): WAMessage {
  return {
    key,
    message: {
      [media.type]: {
        url: media.url,
        directPath: media.direct_path,
        mediaKey: bytes(media.media_key),
        fileEncSha256: bytes(media.file_enc_sha256),
        fileSha256: bytes(media.file_sha256),
        mimetype: media.mimetype,
      },
    },
  } as WAMessage;
}

/**
 * WhatsApp deletes its copy of a file after a while (404 or 410), and old links stop working (403).
 * The phone can upload it again on request. Baileys means to do that itself but checks the wrong field on its own errors, so it is done
 * here: one re-upload request, then one more try.
 */
async function download(sock: WASocket, msg: WAMessage): Promise<Buffer> {
  try {
    return await downloadMediaMessage(msg, "buffer", {}, { logger: silentLogger, reuploadRequest: sock.updateMediaMessage });
  } catch (err) {
    const status = (err as { output?: { statusCode?: number } }).output?.statusCode;
    if (status !== 403 && status !== 404 && status !== 410) throw err;
    const fresh = await sock.updateMediaMessage(msg);
    return downloadMediaMessage(fresh, "buffer", {}, { logger: silentLogger, reuploadRequest: sock.updateMediaMessage });
  }
}

/** Downloads one file and records where it went. Returns false when it is too large to keep. */
export async function saveMedia(sock: WASocket, msg: WAMessage, row: { userId: string; messageId: string; attachmentId: string; mimeType: string }): Promise<boolean> {
  const content = await download(sock, msg);
  if (content.length > MAX_FILE_BYTES) return false;
  const path = attachmentPath(row.userId, row.messageId, row.attachmentId);
  await uploadObject(ATTACHMENTS_BUCKET, path, content, storedType(row.mimeType));
  must(await db.from("attachments").update({ storage_path: path, size_bytes: content.length }).eq("id", row.attachmentId), "save attachment path");
  return true;
}
