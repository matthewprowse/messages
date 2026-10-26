import type { FolderRole } from "../ingest/store-email";
import { imapMove, imapThreadPlace, type ImapPlace, type ImapMove } from "../ingest/imap-place";

// Pure helpers for where mail lives in Outlook. No I/O, so they can be unit tested.
// Outlook works like IMAP: each message is in exactly one folder. Folders are named by Graph's
// well-known names, which Graph also takes as a destination, so no folder IDs are stored. The IMAP
// rules in imap-place.ts are reused by translating the Inbox's name.

export type OutlookFolder = "inbox" | "sentitems" | "archive" | "junkemail" | "deleteditems";

/** New mail in these folders is imported. */
export const IMPORT_FOLDERS: OutlookFolder[] = ["inbox", "sentitems", "archive"];
/** Only mail the app already has is followed here, so a conversation moved to Junk or Deleted Items follows. */
export const WATCH_FOLDERS: OutlookFolder[] = ["junkemail", "deleteditems"];

/** What the message would be on IMAP: Sent, Inbox, or archived for everything else. */
export function roleOf(folder: OutlookFolder): FolderRole {
  if (folder === "sentitems") return "sent";
  if (folder === "inbox") return "inbox";
  return "archive";
}

function paths(hasArchive: boolean) {
  return { archive: hasArchive ? "archive" : undefined, trash: "deleteditems", junk: "junkemail" };
}

const toImap = (folder: string | null | undefined) => (folder === "inbox" ? "INBOX" : (folder ?? undefined));
const fromImap = (folder: string) => (folder === "INBOX" ? "inbox" : folder) as OutlookFolder;

/**
 * Where a conversation is in Outlook: in the Inbox while any message is, otherwise Deleted Items or Junk
 * when all mail from other people is there, otherwise archived. A message whose folder is not known
 * (moved to a folder of your own, or deleted for good) counts as archived.
 */
export function outlookThreadPlace(messages: { folder: OutlookFolder | null | undefined; direction: string }[], hasArchive: boolean): ImapPlace {
  return imapThreadPlace(messages.map((m) => ({ folder: toImap(m.folder), direction: m.direction })), paths(hasArchive));
}

export interface OutlookMove extends Omit<ImapMove, "from" | "to"> {
  from: OutlookFolder[];
  to: (origin?: OutlookFolder) => OutlookFolder;
}

/** The folder moves for one app action, the missing folder's name, or null for read state. */
export function outlookMove(action: string, hasArchive: boolean): OutlookMove | { missing: "archive" | "trash" | "junk" } | null {
  const move = imapMove(action, paths(hasArchive));
  if (!move || "missing" in move) return move;
  return { from: move.from.map(fromImap), to: (origin) => fromImap(move.to(toImap(origin))), remember: move.remember };
}

/** One message as a folder's delta reports it. */
export interface DeltaMessage {
  id: string;
  conversationId?: string;
  isRead?: boolean;
  isDraft?: boolean;
  receivedDateTime?: string;
  "@removed"?: { reason?: string };
}

export interface SeenMessage {
  folder: OutlookFolder;
  conversationId: string | null;
  isRead: boolean;
  isDraft: boolean;
  receivedAt: string | null;
}

export interface DeltaChanges {
  /** Messages present in a folder, with their state now. */
  seen: Map<string, SeenMessage>;
  /** Messages that left a folder and were not seen in another one, with the folder they left. */
  left: Map<string, OutlookFolder>;
}

/**
 * Folds one round of folder deltas into the state per message. A message that moved shows as removed
 * from one folder and present in another; being present wins, whatever order the folders were read in.
 */
export function foldDeltas(rounds: { folder: OutlookFolder; messages: DeltaMessage[] }[]): DeltaChanges {
  const seen = new Map<string, SeenMessage>();
  const left = new Map<string, OutlookFolder>();
  for (const { folder, messages } of rounds) {
    for (const m of messages) {
      if (m["@removed"]) {
        if (!seen.has(m.id)) left.set(m.id, folder);
        continue;
      }
      left.delete(m.id);
      seen.set(m.id, {
        folder,
        conversationId: m.conversationId ?? null,
        isRead: m.isRead ?? true,
        isDraft: m.isDraft ?? false,
        receivedAt: m.receivedDateTime ?? null,
      });
    }
  }
  return { seen, left };
}
