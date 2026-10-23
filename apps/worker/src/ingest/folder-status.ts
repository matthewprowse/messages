// Deciding when an IMAP folder other than the Inbox needs syncing, from a STATUS reply. STATUS asks the
// server about a folder without selecting it, so the Inbox stays selected and IDLE keeps watching it.

/** A full sync of each side folder at least this often, whatever STATUS says. */
export const SIDE_FOLDER_FULL_SYNC_MS = 10 * 60_000;

/** The parts of a STATUS reply that change when mail arrives, leaves or the folder is renumbered. */
export interface FolderStatus {
  uidNext?: number;
  uidValidity?: bigint;
  messages?: number;
}

/** A folder's STATUS as it was just before its last sync, and when that sync ran. */
export interface FolderCheck {
  status: FolderStatus | null;
  syncedAt: number;
}

/**
 * Whether a side folder should be selected and synced now: never synced this session, no usable STATUS,
 * its last sync too long ago, or UIDNEXT, UIDVALIDITY or the message count changed since that sync.
 */
export function sideFolderDue(last: FolderCheck | undefined, now: FolderStatus | null, at: number): boolean {
  if (!last || !last.status || !now) return true;
  if (now.uidNext === undefined || now.messages === undefined) return true;
  if (at - last.syncedAt >= SIDE_FOLDER_FULL_SYNC_MS) return true;
  return now.uidNext !== last.status.uidNext || now.uidValidity !== last.status.uidValidity || now.messages !== last.status.messages;
}
