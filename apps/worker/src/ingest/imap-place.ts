// Pure helpers for where mail lives on an IMAP server such as iCloud. No I/O, so they can be unit tested.
// Unlike Gmail, each message is in exactly one folder: the Inbox, Archive, Sent, Trash or Junk.

export interface FolderPaths {
  archive?: string;
  /** The \Trash special-use folder, "Deleted Messages" on iCloud. */
  trash?: string;
  /** The \Junk special-use folder. */
  junk?: string;
}

export type ImapPlace = "inbox" | "archived" | "trash" | "spam";

/**
 * In the Inbox while any message is. Otherwise in Trash or Junk when every message from other people
 * is there, so your replies staying in Sent do not hold it back. A conversation of only your own
 * messages goes by those. Messages whose folder is unknown count as archived.
 */
export function imapThreadPlace(messages: { folder?: string; direction: string }[], paths: FolderPaths): ImapPlace {
  if (messages.some((m) => m.folder === "INBOX")) return "inbox";
  const inbound = messages.filter((m) => m.direction === "inbound");
  const judged = inbound.length > 0 ? inbound : messages;
  if (judged.length === 0) return "archived";
  const inTrash = (m: { folder?: string }) => !!paths.trash && m.folder === paths.trash;
  const inJunk = (m: { folder?: string }) => !!paths.junk && m.folder === paths.junk;
  if (judged.every(inTrash)) return "trash";
  if (judged.every((m) => inJunk(m) || inTrash(m))) return "spam";
  return "archived";
}

export interface ImapMove {
  /** Folders whose copies move. */
  from: string[];
  /** Where they go. Undoing a delete sends each message back where it came from, or to the Inbox. */
  to: (origin?: string) => string;
  /** Saves where each message came from, so a delete can be undone exactly. */
  remember: boolean;
}

/** The folder moves for one app action, or a missing folder's name. Read state is not a move. */
export function imapMove(action: string, paths: FolderPaths): ImapMove | { missing: "archive" | "trash" | "junk" } | null {
  const inbox = () => "INBOX";
  switch (action) {
    case "archive":
      return paths.archive ? { from: ["INBOX"], to: () => paths.archive!, remember: false } : { missing: "archive" };
    case "unarchive":
      return paths.archive ? { from: [paths.archive], to: inbox, remember: false } : { missing: "archive" };
    // Deleting from the app's Junk moves Junk copies too.
    case "trash":
      return paths.trash
        ? { from: ["INBOX", ...[paths.archive, paths.junk].filter((p): p is string => !!p)], to: () => paths.trash!, remember: true }
        : { missing: "trash" };
    case "untrash":
      return paths.trash ? { from: [paths.trash], to: (origin) => origin ?? "INBOX", remember: false } : { missing: "trash" };
    case "spam":
      return paths.junk
        ? { from: ["INBOX", ...(paths.archive ? [paths.archive] : [])], to: () => paths.junk!, remember: false }
        : { missing: "junk" };
    // Remembers that the mail came from Junk, so undoing Not Junk puts back only that mail.
    case "unspam":
      return paths.junk ? { from: [paths.junk], to: inbox, remember: true } : { missing: "junk" };
    default:
      return null;
  }
}
