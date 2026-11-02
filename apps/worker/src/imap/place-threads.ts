// Moves conversations with nothing left in the Inbox to where their mail is: archived, deleted, or the app's Junk for
// mail in Junk. Database writes for connectors/imap.ts; the folder-to-place rule is imapThreadPlace (ingest/imap-place.ts).

import { allRows, db, must } from "../db";
import { imapThreadPlace, type FolderPaths } from "../ingest/imap-place";
import { chunks, push } from "../util";

const THREADS_AT_ONCE = 100; // thread ids in one .in() filter, to keep the request URL short

/**
 * Conversations with a change from the app still on its way are left alone. untrash: mail just turned up in
 * Archive, so a deleted conversation is archived again. Returns how many conversations changed.
 */
export async function placeThreads(accountId: string, paths: FolderPaths, threadIds: string[], untrash = false): Promise<number> {
  if (threadIds.length === 0) return 0;
  // Every message of every thread is read, a chunk of threads and a page of rows at a time, so no
  // thread is judged on part of its mail and archived by mistake.
  const byThread = new Map<string, { folder?: string; direction: string }[]>();
  const waiting = new Set<string>();
  for (const chunk of chunks(threadIds, THREADS_AT_ONCE)) {
    const rows = await allRows(
      (from, to) =>
        db.from("messages").select("id, thread_id, direction, provider_meta").in("thread_id", chunk).eq("account_id", accountId).order("id").range(from, to),
      "check thread folders",
    );
    for (const r of rows) push(byThread, r.thread_id, { folder: (r.provider_meta as { folder?: string }).folder, direction: r.direction });
    const queued = await allRows(
      (from, to) => db.from("mail_actions").select("id, thread_id").in("thread_id", chunk).in("status", ["queued", "working"]).order("id").range(from, to),
      "check queued actions",
    );
    for (const r of queued) waiting.add(r.thread_id);
  }
  const place = new Map(threadIds.filter((id) => !waiting.has(id)).map((id) => [id, imapThreadPlace(byThread.get(id) ?? [], paths)]));
  const at = (wanted: string) => [...place].filter(([, p]) => p === wanted).map(([id]) => id);

  let changed = 0;
  const count = (rows: { id: string }[]) => (changed += rows.length);
  const threads = () => db.from("threads");
  const archive = at("archived");
  if (archive.length) {
    count(must(await threads().update({ status: "archived" }).in("id", archive).eq("status", "inbox").select("id"), "archive threads"));
    if (untrash) count(must(await threads().update({ status: "archived" }).in("id", archive).eq("status", "trash").select("id"), "untrash threads"));
  }
  const binned = at("trash");
  if (binned.length) count(must(await threads().update({ status: "trash" }).in("id", binned).in("status", ["inbox", "archived"]).select("id"), "bin threads"));
  const junk = at("spam");
  if (junk.length) {
    count(must(await threads().update({ status: "inbox" }).in("id", junk).neq("status", "inbox").select("id"), "show junk threads"));
    count(must(await threads().update({ junk: true }).in("id", junk).eq("junk", false).select("id"), "mark junk threads"));
  }
  return changed;
}
