// Notices mail that left the Inbox on another device (archived, moved, deleted or marked as junk), and looks for it in
// Trash and Junk so a conversation deleted on your phone leaves the app's inbox as deleted. I/O for connectors/imap.ts;
// the deciding is in ./inbox-rows.ts.

import type { ImapFlow } from "imapflow";
import type { Json } from "@messages/db";
import { allRows, db, must } from "../db";
import { log } from "../log";
import type { FolderPaths } from "../ingest/imap-place";
import { keepIngestMeta } from "../ingest/ingest-meta";
import { chunks, mapLimit } from "../util";
import { currentRows, goneRows } from "./inbox-rows";
import { uidSet } from "../connectors/uid-set";

const LOCATE_AT_ONCE = 25; // Message-IDs looked up in one search of Trash or Junk
const WRITE_AT_ONCE = 6; // row updates in flight together

/** What the pass needs from the connector. `paths` is read when the pass runs, as discovery sets it per session. */
export interface ReconcileCtx {
  accountId: string;
  tag: string;
  paths(): FolderPaths;
  selectInbox(client: ImapFlow): Promise<void>;
  placeThreads(threadIds: string[]): Promise<number>;
}

export async function reconcileInboxFully(ctx: ReconcileCtx, client: ImapFlow) {
  const rows = await allRows(
    (from, to) =>
      db
        .from("messages")
        .select("id, thread_id, provider_message_id, provider_meta")
        .eq("account_id", ctx.accountId)
        .eq("provider_meta->>folder", "INBOX")
        .order("id")
        .range(from, to),
    "load inbox messages",
  );
  if (rows.length === 0) return;

  const lock = await client.getMailboxLock("INBOX");
  let gone: typeof rows;
  try {
    const uidValidity = Number(client.mailbox && client.mailbox.uidValidity);
    const { current, uids } = currentRows(rows, uidValidity);
    const present = new Set<number>(uids.length ? ((await client.search({ uid: uidSet(uids) }, { uid: true })) || []) : []);
    gone = goneRows(rows, current, present);
  } finally {
    lock.release();
  }
  if (gone.length === 0) return;

  const found = await locate(ctx, client, gone);
  // provider_meta is rebuilt for where the mail went, keeping what ingest read from its headers (ingest-meta.ts). Rows
  // with nothing to keep are written together; the rest one by one, as each keeps its own.
  const metaOf = new Map(gone.map((r) => [r.id, r.provider_meta]));
  const unknown = gone.filter((r) => !found.has(r.id));
  const plain = new Set(unknown.filter((r) => Object.keys(keepIngestMeta(r.provider_meta, {})).length === 0).map((r) => r.id));
  for (const ids of chunks([...plain], 200)) {
    must(await db.from("messages").update({ provider_meta: { left: "INBOX" } }).in("id", ids), "mark messages gone");
  }
  const kept = unknown.filter((r) => !plain.has(r.id)).map((r): [string, Json] => [r.id, keepIngestMeta(r.provider_meta, { left: "INBOX" })]);
  const placed = [...found].map(([id, meta]): [string, Json] => [id, keepIngestMeta(metaOf.get(id), meta)]);
  await mapLimit([...kept, ...placed], WRITE_AT_ONCE, async ([id, meta]) => {
    must(await db.from("messages").update({ provider_meta: meta }).eq("id", id), "save found message");
  });

  const moved = await ctx.placeThreads([...new Set(gone.map((r) => r.thread_id))]);
  log.info(`${ctx.tag} inbox reconciled`, { account: ctx.accountId, left: gone.length, found: found.size, moved });
}

/**
 * Looks for mail that left the Inbox in Trash and Junk, by Message-ID, a batch at a time.
 * Mail not found there was archived or moved to another folder. Leaves the Inbox selected again.
 */
async function locate(ctx: ReconcileCtx, client: ImapFlow, gone: { id: string; provider_message_id: string }[]) {
  const found = new Map<string, { folder: string; uid: number; uid_validity: number }>();
  const byMessageId = new Map(gone.filter((r) => r.provider_message_id.startsWith("<")).map((r) => [r.provider_message_id, r.id]));
  if (byMessageId.size === 0) return found;
  const paths = ctx.paths();
  try {
    for (const path of [paths.trash, paths.junk]) {
      if (!path) continue;
      const todo = [...byMessageId.keys()].filter((mid) => !found.has(byMessageId.get(mid)!));
      if (todo.length === 0) break;
      const lock = await client.getMailboxLock(path);
      try {
        const uidValidity = Number(client.mailbox && client.mailbox.uidValidity);
        for (const batch of chunks(todo, LOCATE_AT_ONCE)) {
          const query = batch.length === 1 ? { header: { "message-id": batch[0] } } : { or: batch.map((mid) => ({ header: { "message-id": mid } })) };
          const uids = (await client.search(query, { uid: true })) || [];
          if (uids.length === 0) continue;
          for await (const msg of client.fetch(uids, { uid: true, envelope: true }, { uid: true })) {
            const id = msg.envelope?.messageId && byMessageId.get(msg.envelope.messageId.trim());
            if (id) found.set(id, { folder: path, uid: msg.uid, uid_validity: uidValidity });
          }
        }
      } finally {
        lock.release();
      }
    }
  } finally {
    await ctx.selectInbox(client);
  }
  return found;
}
