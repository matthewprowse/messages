// Finds WhatsApp files that were never saved (a failed download, or one the phone had to upload again) and works out
// the downloads to retry. Reads the database only; the connector (connectors/whatsapp.ts) queues the downloads.

import type { WAMessage } from "baileys";
import { db, must } from "../db";
import { env } from "../env";
import { MAX_FILE_BYTES } from "../file-store";
import { openAddresses } from "../vault";
import type { BoundedMap } from "./bounded-map";
import { messageFromRef, type MediaRow } from "./media";
import type { AccountCtx, StoredMeta } from "./person";

const STICKER_PASS_IDLE_MS = 60 * 60_000; // old stickers are looked for this rarely once a pass finds none missing
const SPENT_IN_QUERY = 300; // files past their tries named in the catch-up query, newest first, to keep the URL short
export const MAX_FILE_TRIES = 3; // per file, per worker run

export interface MissingMediaJob {
  msg: WAMessage;
  row: Omit<MediaRow, "userId" | "accountId">;
}

/**
 * Files not saved yet within the import window, as downloads to run. Counts each attempt in `fileTries`, and skips
 * files past MAX_FILE_TRIES. `stickers.idleSince` is when the sticker pass last found nothing missing (0 when it did).
 */
export async function missingMediaJobs(ctx: AccountCtx, fileTries: BoundedMap<string, number>, stickers: { idleSince: number }): Promise<MissingMediaJob[]> {
  const since = new Date(Date.now() - env.initialSyncDays * 86_400_000).toISOString();
  // Files already past their tries are left out of the query, or they would fill the limit and starve the rest.
  const spent = [...fileTries].filter(([, tries]) => tries >= MAX_FILE_TRIES).map(([id]) => id).slice(-SPENT_IN_QUERY);
  const missing = () => {
    const query = db
      .from("attachments")
      .select("id, mime_type, kind, filename, size_bytes, message_id, messages!inner(account_id, provider_message_id, provider_meta, sent_at)")
      .is("storage_path", null)
      // A video kept as a link is not fetched; a file refused for a full seat is tried again once there is room.
      .or("not_kept.is.null,not_kept.eq.over_cap")
      .eq("messages.account_id", ctx.accountId)
      .lte("size_bytes", MAX_FILE_BYTES);
    return (spent.length > 0 ? query.not("id", "in", `(${spent.join(",")})`) : query).limit(100);
  };
  const recent = await missing().gte("messages.sent_at", since).then((r) => must(r, "load missing whatsapp files"));
  // Stickers are kept at any age, but a new one is inside the window above, so older ones are only looked
  // for when the recent pass found work, or once an hour after a pass that found none.
  let found: typeof recent = [];
  if (recent.length > 0 || Date.now() - stickers.idleSince >= STICKER_PASS_IDLE_MS) {
    found = await missing().eq("is_sticker", true).then((r) => must(r, "load missing whatsapp stickers"));
    stickers.idleSince = found.length === 0 ? Date.now() : 0;
  }
  if (recent.length === 0 && found.length === 0) return [];
  const rows = await openAddresses(ctx.userId, [...new Map([...recent, ...found].map((r) => [r.id, r])).values()]);
  const jobs: MissingMediaJob[] = [];
  for (const r of rows) {
    const tries = fileTries.get(r.id) ?? 0;
    if (tries >= MAX_FILE_TRIES) continue;
    fileTries.set(r.id, tries + 1);
    const meta = r.messages.provider_meta as unknown as StoredMeta;
    if (!meta?.media) continue;
    const key = { remoteJid: meta.chat, fromMe: meta.from_me, id: r.messages.provider_message_id, participant: meta.participant ?? undefined };
    jobs.push({
      msg: messageFromRef(key, meta.media),
      row: { messageId: r.message_id, attachmentId: r.id, mimeType: r.mime_type ?? "application/octet-stream", kind: r.kind, filename: r.filename, sizeBytes: r.size_bytes },
    });
  }
  return jobs;
}
