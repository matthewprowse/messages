// Which stored outbox files the daily cleanup may remove. Pure, so the safety rule is tested: an object is only ever
// removed from its own user's outbox folder, whatever a row says.

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";

/** Whether `path` is an object under "<user id>/outbox/<uuid>/" of the row's own user, with no way out of that folder. */
export function removableOutboxPath(userId: string, path: string): boolean {
  if (!new RegExp(`^${UUID}$`).test(userId) || path.split("/").some((part) => part === ".." || part === ".")) return false;
  return new RegExp(`^${userId}/outbox/${UUID}/[^/]+$`).test(path);
}
