// Imports the mail in one IMAP folder that is newer than where the last sync stopped. Stored in batches (25 messages or
// about 16 MB of attachments), with progress saved after each so a restart resumes, not repeats. A message over
// MESSAGE_MAX_BYTES is stored from its headers only (message-size.ts). Used by connectors/imap.ts, which keeps the
// session state this reads through SyncCtx.

import type { ImapFlow } from "imapflow";
import { db, must, type AccountRow } from "../db";
import { env } from "../env";
import { log } from "../log";
import { saveFilesQuietly } from "../ingest/attachment-files";
import { isFailure } from "../ingest/batch-rpc";
import { parseEmail, type NormalizedEmail } from "../ingest/normalize-email";
import { type AuthservTrust } from "../ingest/email-auth";
import { storeEmails, type FolderRole } from "../ingest/store-email";
import { oversizeSource, sizeRuns } from "./message-size";

export interface Folder {
  path: string;
  role: FolderRole;
}

const CHECKPOINT_EVERY = 25; // messages stored per database call, then progress saved, so a restart resumes, not repeats
const CHECKPOINT_BYTES = 16 * 1024 * 1024; // ...or sooner when the parsed messages held in memory (attachments mostly) reach this size

/** What a folder sync needs from the connector. selfAddresses is read when a batch is stored, as it may change mid-sync. */
export interface SyncCtx {
  account: AccountRow;
  tag: string;
  selfAddresses(): Set<string>;
  /** Which Authentication-Results servers count for this account (ingest/email-auth.ts authservTrust). */
  trustAuth: AuthservTrust;
  folderState(path: string): Promise<{ uid_validity: number | null; last_uid: number | null } | null>;
  saveFolderState(path: string, uidValidity: number, lastUid: number): Promise<void>;
  placeThreads(threadIds: string[], untrash?: boolean): Promise<number>;
}

/** Imports anything in this folder newer than where the last sync stopped. */
export async function syncFolder(ctx: SyncCtx, client: ImapFlow, folder: Folder) {
  const lock = await client.getMailboxLock(folder.path);
  try {
    const box = client.mailbox;
    if (!box) return;
    const uidValidity = Number(box.uidValidity);
    const newestUid = box.uidNext - 1;
    const state = await ctx.folderState(folder.path);

    // A changed UIDVALIDITY means the server renumbered the folder, so start it again.
    const fresh = !state || state.uid_validity !== uidValidity || state.last_uid === null;
    let range: number[] | string;
    if (fresh) {
      const since = new Date(Date.now() - env.initialSyncDays * 86_400_000);
      const found = await client.search({ since }, { uid: true });
      if (!found || found.length === 0) {
        await ctx.saveFolderState(folder.path, uidValidity, newestUid);
        return;
      }
      range = found;
    } else {
      // Ask the server which messages are newer than the last one stored. The cached UIDNEXT is not
      // enough: when IDLE reports new mail in the folder that is already open, imapflow updates the
      // message count but not UIDNEXT, so trusting it left new mail waiting for the next minute's poll.
      const newer = ((await client.search({ uid: `${state.last_uid! + 1}:*` }, { uid: true })) || []).filter((uid) => uid > state.last_uid!);
      if (newer.length === 0) return;
      range = newer;
    }

    const floor = fresh ? 0 : state!.last_uid!;
    let lastUid = floor; // progress: every message up to here is stored
    let savedUid = floor;
    let inserted = 0;
    let failed = 0;
    let failure: string | null = null; // the first message that could not be stored: progress stops before it
    const movedOut = new Set<string>(); // known mail found outside the Inbox: moved on another device
    let seenCount = 0;
    let pending: { uid: number; mail: NormalizedEmail; seen: boolean }[] = [];
    let pendingBytes = 0; // attachment bytes held by pending

    // Stores what has been fetched so far in one call (a first sync), or alone (new mail), in order.
    const flush = async () => {
      const batch = pending;
      pending = [];
      pendingBytes = 0;
      if (batch.length === 0) return;
      const results = await storeEmails(
        ctx.account,
        batch.map((m) => ({
          mail: m.mail,
          ctx: { role: folder.role, meta: { folder: folder.path, uid: m.uid, uid_validity: uidValidity }, seen: m.seen, selfAddresses: ctx.selfAddresses() },
        })),
      );
      for (const [i, stored] of results.entries()) {
        const { uid, mail } = batch[i];
        if (isFailure(stored)) {
          failed++;
          failure ??= stored.code;
          continue;
        }
        // Mail moved back into the Inbox on another device brings its conversation back too.
        if (stored.result === "updated" && folder.role === "inbox" && stored.threadId) {
          must(await db.from("threads").update({ status: "inbox" }).eq("id", stored.threadId).in("status", ["archived", "trash"]), "restore thread");
        }
        if (stored.result === "updated" && folder.role === "archive" && stored.threadId) movedOut.add(stored.threadId);
        if (stored.result === "inserted") {
          inserted++;
          if (stored.messageId) await saveFilesQuietly(ctx.account.id, ctx.account.user_id, stored.messageId, mail.attachments);
        }
        mail.attachments = []; // stored (or skipped): release the file Buffers now, not when the batch array goes
        if (failure === null) lastUid = Math.max(lastUid, uid);
      }
    };

    // Sizes first (cheap), so a message too large to hold in memory is never downloaded whole. Runs keep UID order,
    // which the progress above relies on. "N:*" always returns the newest message, even when it is older than N.
    const sizes: { uid: number; size?: number }[] = [];
    for await (const msg of client.fetch(range, { uid: true, size: true }, { uid: true })) if (msg.uid > floor) sizes.push({ uid: msg.uid, size: msg.size });
    let oversize = 0;
    for (const run of sizeRuns(sizes)) {
      const query = run.big ? { uid: true, flags: true, headers: true } : { uid: true, flags: true, source: true };
      for await (const msg of client.fetch(run.uids, query, { uid: true })) {
        if (msg.uid <= floor) continue;
        const raw = run.big ? msg.headers && oversizeSource(msg.headers) : msg.source;
        if (!raw) continue;
        if (run.big) oversize++;
        const mail = await parseEmail(raw, `${folder.path}:${uidValidity}:${msg.uid}`, ctx.trustAuth);
        pending.push({ uid: msg.uid, mail, seen: msg.flags?.has("\\Seen") ?? false });
        seenCount++;
        pendingBytes += mail.attachments.reduce((n, a) => n + a.content.length, 0);
        if (pending.length >= CHECKPOINT_EVERY || pendingBytes >= CHECKPOINT_BYTES) {
          await flush();
          if (lastUid > savedUid) await ctx.saveFolderState(folder.path, uidValidity, (savedUid = lastUid));
        }
      }
    }
    await flush();
    if (oversize) log.info(`${ctx.tag} oversize mail stored as headers only`, { account: ctx.account.id, count: oversize });

    // After a failure, progress stops before the message that failed, so the next sync tries it again.
    // A first sync that stored nothing saves nothing, so it stays a first sync.
    if (failure === null) await ctx.saveFolderState(folder.path, uidValidity, Math.max(lastUid, fresh ? newestUid : lastUid));
    else if (lastUid > savedUid) await ctx.saveFolderState(folder.path, uidValidity, lastUid);
    if (movedOut.size) await ctx.placeThreads([...movedOut], true);
    if (seenCount > 0) log.info(`${ctx.tag} folder synced`, { account: ctx.account.id, role: folder.role, processed: seenCount, inserted, failed });
    if (failure !== null) throw Object.assign(new Error("message not stored"), { code: failure });
  } finally {
    lock.release();
  }
}
