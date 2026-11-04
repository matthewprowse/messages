// The WhatsApp profile picture pass: reads the account's chats, decides which are due (./photo-jobs.ts), then looks
// each up over the link and saves it. I/O only; the connector guards against two passes at once.

import type { WASocket } from "baileys";
import { sleep } from "../backoff";
import { allRows, db } from "../db";
import { log } from "../log";
import { saveContactPhoto, saveGroupPhoto } from "../photos/store";
import { openAddresses } from "../vault";
import { isWhatsAppPhotoUrl, readCapped } from "./media-guard";
import { photoJobsDue } from "./photo-jobs";
import type { AccountCtx } from "./person";

const PHOTO_STALE_MS = 7 * 24 * 60 * 60_000;
const PHOTO_PAUSE_MS = 2_000; // one lookup at a time, like WhatsApp Web loading pictures as you scroll
const PHOTO_MAX_BYTES = 2 * 1024 * 1024; // the most photos/store.ts keeps; a preview is a few KB
const PHOTO_FETCH_MS = 30_000;

/**
 * The picture behind a link WhatsApp gave, read with a byte cap. Null when there is none (an error status), and
 * undefined when it is not fetched or read at all: a link off whatsapp.net, a redirect away from it, or too large,
 * so the picture already saved is left as it is.
 */
async function fetchPhoto(url: string): Promise<Buffer | null | undefined> {
  if (!isWhatsAppPhotoUrl(url)) return undefined;
  const res = await fetch(url, { signal: AbortSignal.timeout(PHOTO_FETCH_MS) }).catch(() => null);
  if (!res?.ok) return null;
  if (!isWhatsAppPhotoUrl(res.url) || !res.body || Number(res.headers.get("content-length") ?? 0) > PHOTO_MAX_BYTES) {
    await res.body?.cancel().catch(() => undefined);
    return undefined;
  }
  return (await readCapped(res.body, PHOTO_MAX_BYTES).catch(() => null)) ?? undefined;
}

/**
 * Profile pictures for people and groups in your chats, looked up one at a time with a pause between,
 * and again after a week. A picture from your own address book is never replaced. `linkIsCurrent` is false once
 * the socket was replaced, closed or stopped, which ends the pass.
 */
export async function syncPhotos(ctx: AccountCtx, sock: WASocket, linkIsCurrent: () => boolean) {
  const stale = new Date(Date.now() - PHOTO_STALE_MS).toISOString();
  const threads = await allRows(
    (from, to) =>
      db
        .from("threads")
        .select("id, is_group, provider_thread_id, avatar_updated_at, thread_participants(contact_id, contacts(avatar_source, avatar_updated_at))")
        .eq("account_id", ctx.accountId)
        .order("id")
        .range(from, to),
    "load chats for photos",
  ).then((rows) => openAddresses(ctx.userId, rows));
  const jobs = photoJobsDue(threads, stale).map((job) => ({
    jid: job.jid,
    save: (b: Buffer | null) =>
      job.kind === "group"
        ? saveGroupPhoto(ctx.userId, job.threadId, b)
        : saveContactPhoto(ctx.userId, job.contactId, "whatsapp", b, { avatar_source: job.avatarSource }),
  }));

  let saved = 0;
  for (const job of jobs) {
    if (!linkIsCurrent()) break;
    // No picture, or hidden by the person's privacy settings, comes back as an error or nothing.
    const url = await sock.profilePictureUrl(job.jid, "preview").catch(() => undefined);
    const bytes = url ? await fetchPhoto(url) : null;
    if (bytes !== undefined && (await job.save(bytes))) saved++;
    await sleep(PHOTO_PAUSE_MS);
  }
  if (jobs.length) log.info("whatsapp photos checked", { account: ctx.accountId, checked: jobs.length, saved });
}
