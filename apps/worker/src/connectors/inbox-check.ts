// When the Inbox reconcile (imap.ts) has to run in full. Reading every Inbox row and searching every UID costs
// requests and megabytes that grow with the mailbox, so the five-minute pass first compares three numbers the
// server already told us (UIDVALIDITY, UIDNEXT and the message count) with the ones from the last full pass. If
// they still add up, nothing was expunged or renumbered and the pass is skipped. A full pass still runs on the
// first look of a session, when UIDVALIDITY changes, when the count is not what new arrivals explain, when an
// expunge event arrived, and at least once an hour as a backstop.

/** What the server reported for the Inbox. */
export interface InboxMark {
  uidValidity: number;
  uidNext: number;
  exists: number;
}

/** Longest the full pass may be skipped for. */
export const FULL_RECONCILE_EVERY_MS = 60 * 60_000;

/**
 * Whether the Inbox must be reconciled in full. last: the mark and time of the previous full pass this session
 * (null on the first). forced: an expunge event or other known change. New mail raises UIDNEXT and the count by
 * the same amount, so any other count means something left (or a UID was reused after a renumbering).
 */
export function reconcileDue(last: { mark: InboxMark; at: number } | null, now: InboxMark, at: number, forced = false): boolean {
  if (forced || !last) return true;
  if (at - last.at >= FULL_RECONCILE_EVERY_MS || at < last.at) return true;
  if (last.mark.uidValidity !== now.uidValidity) return true;
  if (now.uidNext < last.mark.uidNext) return true;
  return now.exists !== last.mark.exists + (now.uidNext - last.mark.uidNext);
}
