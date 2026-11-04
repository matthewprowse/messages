// Which stored outbox files the cleanup may remove, and when. Pure, so the rules are tested: an object is only ever
// removed from its own user's outbox folder, whatever a row says, and only once its message is done with it.

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";

/** Whether `path` is an object under "<user id>/outbox/<uuid>/" of the row's own user, with no way out of that folder. */
export function removableOutboxPath(userId: string, path: string): boolean {
  if (!new RegExp(`^${UUID}$`).test(userId) || path.split("/").some((part) => part === ".." || part === ".")) return false;
  return new RegExp(`^${userId}/outbox/${UUID}/[^/]+$`).test(path);
}

/** The user an outbox object belongs to: the first folder of "<user id>/outbox/...", or null for any other path. */
export function outboxOwner(path: string): string | null {
  const [user, folder] = path.split("/");
  return folder === "outbox" && new RegExp(`^${UUID}$`).test(user ?? "") ? user : null;
}

const HOUR_MS = 60 * 60 * 1000;
/** A sent message's files go a day after it was sent: the provider and the stored sent copy have them. */
export const SENT_KEEP_MS = 24 * HOUR_MS;
/** A failed message's files go a day after they were added: a failed send with files is never retried from them. */
export const FAILED_KEEP_MS = 24 * HOUR_MS;
/** Files of a message that never went (stuck queued, or due long ago), and files no row points at (an Undo, an upload
 * whose send was never queued): a week, so a scheduled message keeps its files until it is due. */
export const STUCK_KEEP_MS = 7 * 24 * HOUR_MS;

/** The times before which each kind of outbox file may go, as ISO strings for the queries. */
export function outboxCleanupCutoffs(now: number): { sent: string; failed: string; stuck: string } {
  const at = (ms: number) => new Date(now - ms).toISOString();
  return { sent: at(SENT_KEEP_MS), failed: at(FAILED_KEEP_MS), stuck: at(STUCK_KEEP_MS) };
}
