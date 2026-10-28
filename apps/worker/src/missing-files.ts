// BackoffMissingFiles: the attachment scan that skips files recently tried and gives up on ones that keep failing, with the try counts kept in
// attachment_fetch_state so a restart does not reset them. Wraps MissingFiles from ingest/attachment-files.ts.

import type { SupabaseClient } from "@supabase/supabase-js";
import { decryptBytes, encryptBytes, isSealedBytes, type UserKeys } from "@messages/crypto";
import { FIELD } from "@messages/crypto/fields";
import { db, must } from "./db";
import { MissingFiles } from "./ingest/attachment-files";
import { errorCode, log } from "./log";
import { fileRetryDelay } from "./polling";
import { makeThumbnail, thumbPathFor } from "./photos/thumbnail";
import { ATTACHMENTS_BUCKET, uploadObject } from "./storage";
import { keysFor } from "./vault";

// attachment_fetch_state is not in the generated types until they are regenerated after its migration.
const state = (db as unknown as SupabaseClient).from.bind(db as unknown as SupabaseClient, "attachment_fetch_state");

type Row = { id: string; message_id: string; provider_meta: unknown };

/**
 * MissingFiles with a limit on tries. A file that cannot be fetched is tried again after 10 minutes, then 20,
 * 40 and so on (FILE_FETCH_BASE_MS, doubling), and given up on after FILE_FETCH_MAX_TRIES tries
 * (attachment_fetch_state.gave_up), so a file the server will never return stops costing a fetch every scan.
 * The tries are kept in the database, so a restart does not start them over. A pass that finds nothing
 * due starts the next scan from the first page again.
 */
export class BackoffMissingFiles {
  private inner: MissingFiles;

  constructor(private readonly accountId: string, private readonly pageSize = 200) {
    this.inner = new MissingFiles(accountId, pageSize);
  }

  async next(): Promise<Row[]> {
    const rows = await this.inner.next();
    if (rows.length === 0) {
      this.inner = new MissingFiles(this.accountId, this.pageSize);
      return [];
    }
    const known = new Map<string, { tries: number; next_try_at: string; gave_up: boolean }>();
    const found = must(
      await state().select("attachment_id, tries, next_try_at, gave_up").in("attachment_id", rows.map((r) => r.id)),
      "load file fetch state",
    ) as { attachment_id: string; tries: number; next_try_at: string; gave_up: boolean }[];
    for (const f of found) known.set(f.attachment_id, f);

    const now = Date.now();
    const due = rows.filter((r) => {
      const s = known.get(r.id);
      return !s || (!s.gave_up && Date.parse(s.next_try_at) <= now);
    });
    if (due.length > 0) {
      const writes = due.map((r) => {
        const tries = (known.get(r.id)?.tries ?? 0) + 1;
        const wait = fileRetryDelay(tries);
        return { attachment_id: r.id, tries, gave_up: wait === null, next_try_at: new Date(now + (wait ?? 0)).toISOString(), updated_at: new Date(now).toISOString() };
      });
      must(await state().upsert(writes, { onConflict: "attachment_id" }), "save file fetch state");
    }
    return due;
  }
}

// ---------------------------------------------------------------------------
// Thumbnails for photos saved before thumbnails existed
// ---------------------------------------------------------------------------

/** A photo bigger than this is left for later: downloading and decoding it costs more than one pass should. */
const THUMB_MAX_SOURCE_BYTES = 25 * 1024 * 1024;
/** attachments.thumb_path once a photo was tried and cannot have a thumbnail, so it is not tried again. Tiles treat it as none. */
export const NO_THUMB = "";

export interface ThumbJob {
  id: string;
  user_id: string;
  storage_path: string;
}

/** What backfillThumbnails needs from the outside; replaced in tests. */
export interface ThumbDeps {
  /** Sealed photos with no thumbnail yet, newest first. */
  list(limit: number): Promise<ThumbJob[]>;
  keys(userId: string): Promise<UserKeys>;
  /** The stored (sealed) bytes, or null when the object is gone. */
  download(path: string): Promise<Uint8Array<ArrayBuffer> | null>;
  upload(path: string, bytes: Buffer): Promise<void>;
  setThumb(id: string, thumbPath: string): Promise<void>;
}

// thumb_path is not in the generated types until they are regenerated after its migration.
type Loose = SupabaseClient;
const loose = () => db as unknown as Loose;

const liveThumbDeps: ThumbDeps = {
  async list(limit) {
    const { data, error } = await loose()
      .from("attachments")
      .select("id, user_id, storage_path")
      .eq("kind", "image")
      .eq("sealed", true)
      .eq("is_sticker", false)
      .not("storage_path", "is", null)
      .is("thumb_path", null)
      .lte("size_bytes", THUMB_MAX_SOURCE_BYTES)
      .order("created_at", { ascending: false })
      .limit(limit);
    // The column missing (migration not applied yet) is not an error worth a log line every pass.
    if (error) {
      if ((error as { code?: string }).code === "42703") return [];
      throw Object.assign(new Error("load photos without thumbnails failed"), { code: "THUMB_LIST" });
    }
    return (data ?? []) as ThumbJob[];
  },
  keys: keysFor,
  async download(path) {
    const { data, error } = await db.storage.from(ATTACHMENTS_BUCKET).download(path);
    if (error || !data) return null;
    return new Uint8Array(await data.arrayBuffer());
  },
  upload: (path, bytes) => uploadObject(ATTACHMENTS_BUCKET, path, bytes, "application/octet-stream"),
  async setThumb(id, thumbPath) {
    const { error } = await loose().from("attachments").update({ thumb_path: thumbPath }).eq("id", id);
    if (error) throw Object.assign(new Error("save thumbnail path failed"), { code: "THUMB_ROW" });
  },
};

/**
 * Makes sealed thumbnails for up to `limit` stored photos that have none, newest first, one at a time. A photo that
 * cannot have one (gone from storage, not readable as an image) is marked NO_THUMB so it is not tried every pass; a
 * storage or database failure leaves it for the next pass. Returns how many thumbnails were made.
 */
export async function backfillThumbnails(limit: number, deps: ThumbDeps = liveThumbDeps): Promise<number> {
  const jobs = await deps.list(limit);
  let made = 0;
  for (const job of jobs) {
    try {
      const stored = await deps.download(job.storage_path);
      const plain = stored && isSealedBytes(stored) ? await decryptBytes(await deps.keys(job.user_id), FIELD.attachmentData, stored).catch(() => null) : null;
      const thumb = plain ? await makeThumbnail(Buffer.from(plain.buffer, plain.byteOffset, plain.byteLength)) : null;
      if (!thumb) {
        await deps.setThumb(job.id, NO_THUMB);
        continue;
      }
      const sealed = await encryptBytes(await deps.keys(job.user_id), FIELD.attachmentData, new Uint8Array(thumb));
      const thumbPath = thumbPathFor(job.storage_path);
      await deps.upload(thumbPath, Buffer.from(sealed.buffer, sealed.byteOffset, sealed.byteLength));
      await deps.setThumb(job.id, thumbPath);
      made++;
    } catch (err) {
      log.warn("thumbnail backfill failed", { attachment: job.id, code: errorCode(err) });
    }
  }
  return made;
}
