// Turns mail_actions rows the sync worker failed into one plain sentence for the user. Pure: no network.
// The web app only queues archive, read, trash and the rest; if the provider refuses, the worker marks the row
// failed with a reason, and without this the app would go on showing the change as done.

export interface ActionRow {
  action: string;
  status: string;
  error: string | null;
}

const WHAT: Record<string, string> = {
  read: "Marking as read",
  unread: "Marking as unread",
  archive: "Archiving",
  unarchive: "Moving back to the inbox",
  trash: "Deleting",
  untrash: "Restoring",
  spam: "Moving to Junk",
  unspam: "Moving out of Junk",
  react: "Your reaction",
};

/** When to look again at queued actions (ms after queuing): the worker usually finishes within seconds. */
export const WATCH_DELAYS_MS = [4_000, 12_000, 30_000, 90_000];

/** The toast for failed actions, or null when none failed. Several of one kind are counted, not listed. */
export function failureText(rows: ActionRow[]): string | null {
  const failed = rows.filter((r) => r.status === "failed");
  if (failed.length === 0) return null;
  const first = failed[0];
  const what = WHAT[first.action] ?? "That change";
  const more = failed.length > 1 ? ` (and ${failed.length - 1} more)` : "";
  const why = first.error?.trim() || "It will match on the next change.";
  return `${what} did not reach your mail provider${more}. ${why}`;
}

/** Rows that are still waiting for the worker, so they are looked at again. */
export function stillOpen(rows: ActionRow[]): boolean {
  return rows.some((r) => r.status === "queued" || r.status === "working");
}
