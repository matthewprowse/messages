import { contentHash, encryptBytes, type UserKeys } from "@messages/crypto";
import { FIELD } from "@messages/crypto/fields";
import type { TablesUpdate } from "@messages/db";
import { db, must } from "./db";
import { env } from "./env";
import { ATTACHMENTS_BUCKET, attachmentPath, storedType, uploadObject } from "./storage";
import { isVideoLink, maySave, noteSaved, stateFor, type CapState, type NotKept } from "./storage-rules";
import { keysFor } from "./vault";

// The one way an attachment's bytes are kept: size limits, the video and cap rules, one copy per account, sealing
// with the user's data key, upload, and the row updated to say what happened. Email, WhatsApp and the catch-up
// passes all save through here. A file is sealed ("e1b:" header, fields.ts attachmentData) when ENCRYPT_CONTENT is
// on; the web app opens sealed and plain objects alike.

export const MAX_FILE_BYTES = 50 * 1024 * 1024; // Supabase's default upload limit

export interface FileToKeep {
  userId: string;
  accountId: string;
  messageId: string;
  attachmentId: string;
  kind: string;
  mimeType: string | null | undefined;
  bytes: Buffer;
  /** True when a file of this message is already saved: it may finish inside the grace band. */
  messageStarted?: boolean;
}

export type Kept =
  | { saved: true; path: string; reused: boolean }
  | { saved: false; reason: "too_large" | NotKept };

/** What keepFile needs from the outside: keys, the storage state, the bucket and the attachments table. Replaced in tests. */
export interface KeepDeps {
  encrypting: boolean;
  keys(userId: string): Promise<UserKeys | null>;
  state(userId: string): Promise<CapState>;
  saved(userId: string, bytes: number): Promise<void>;
  upload(path: string, bytes: Buffer, contentType: string): Promise<void>;
  copy(userId: string, accountId: string, hash: string): Promise<{ storage_path: string; sealed: boolean } | null>;
  update(attachmentId: string, patch: TablesUpdate<"attachments">, onlyUnsaved?: boolean): Promise<void>;
}

/** An object this account already holds with the same content, if any. */
async function existingCopy(userId: string, accountId: string, hash: string): Promise<{ storage_path: string; sealed: boolean } | null> {
  const rows = must(
    await db
      .from("attachments")
      .select("storage_path, sealed, messages!inner(account_id)")
      .eq("user_id", userId)
      .eq("content_hash", hash)
      .eq("messages.account_id", accountId)
      .not("storage_path", "is", null)
      .limit(1),
    "find duplicate attachment",
  );
  const row = rows[0];
  return row?.storage_path ? { storage_path: row.storage_path, sealed: row.sealed } : null;
}

const liveDeps: KeepDeps = {
  get encrypting() {
    return env.encryptContent;
  },
  // With encryption on, a file is never stored unsealed: if the user's keys cannot be had this throws and the catch-up
  // tries again. With it off the keys are only used for the content hash, and a missing key service just means no hash.
  keys: (userId) => (env.encryptContent ? keysFor(userId) : keysFor(userId).catch(() => null)),
  state: stateFor,
  saved: noteSaved,
  upload: (path, bytes, contentType) => uploadObject(ATTACHMENTS_BUCKET, path, bytes, contentType),
  copy: existingCopy,
  async update(attachmentId, patch, onlyUnsaved) {
    const query = db.from("attachments").update(patch).eq("id", attachmentId);
    must(await (onlyUnsaved ? query.is("storage_path", null) : query), "save attachment");
  },
};

/** Keeps one file, or says why not. Throws only for a storage or database failure, so the caller can try again later. */
export async function keepFile(file: FileToKeep, deps: KeepDeps = liveDeps): Promise<Kept> {
  const size = file.bytes.length;
  if (size > MAX_FILE_BYTES) return { saved: false, reason: "too_large" };
  if (isVideoLink(file.kind, size)) {
    await deps.update(file.attachmentId, { not_kept: "video_link" }, true);
    return { saved: false, reason: "video_link" };
  }

  const keys = await deps.keys(file.userId);
  if (deps.encrypting && !keys) throw Object.assign(new Error("no keys to seal a file"), { code: "NO_KEYS" });
  const sealing = deps.encrypting;
  const hash = keys ? await contentHash(keys, new Uint8Array(file.bytes)) : null;

  // The same file again in this account (a forwarded PDF) points at the copy already stored and costs no space.
  if (hash) {
    const copy = await deps.copy(file.userId, file.accountId, hash);
    if (copy) {
      await deps.update(file.attachmentId, { storage_path: copy.storage_path, sealed: copy.sealed, content_hash: hash, size_bytes: size, not_kept: null });
      return { saved: true, path: copy.storage_path, reused: true };
    }
  }

  if (!maySave(await deps.state(file.userId), !!file.messageStarted)) {
    await deps.update(file.attachmentId, { not_kept: "over_cap" }, true);
    return { saved: false, reason: "over_cap" };
  }

  const path = attachmentPath(file.userId, file.messageId, file.attachmentId);
  if (sealing && keys) {
    const sealed = await encryptBytes(keys, FIELD.attachmentData, new Uint8Array(file.bytes));
    await deps.upload(path, Buffer.from(sealed.buffer, sealed.byteOffset, sealed.byteLength), "application/octet-stream");
  } else {
    await deps.upload(path, file.bytes, storedType(file.mimeType));
  }
  await deps.update(file.attachmentId, { storage_path: path, sealed: sealing, content_hash: hash, size_bytes: size, not_kept: null });
  await deps.saved(file.userId, size);
  return { saved: true, path, reused: false };
}
