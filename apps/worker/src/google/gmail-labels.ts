import type { FolderRole } from "../ingest/store-email";

// Pure helpers for Gmail's labels and change history. No I/O, so they can be unit tested.
// Gmail has no folders: a message is "in the Inbox" while it has the INBOX label, and unread while it
// has UNREAD. A conversation is in the Inbox while any of its messages is.

/** Messages that never appear in the app: unsent drafts, spam, the bin and old Hangouts chats. */
const HIDDEN = new Set(["DRAFT", "SPAM", "TRASH", "CHAT"]);

export function hidden(labels: string[]): boolean {
  return labels.some((l) => HIDDEN.has(l));
}

/** What the message would be on IMAP: Sent if you sent it, Inbox if it is there, otherwise archived. */
export function roleOf(labels: string[]): FolderRole {
  if (labels.includes("SENT")) return "sent";
  if (labels.includes("INBOX")) return "inbox";
  return "archive";
}

export interface HistoryMessage {
  id: string;
  threadId: string;
  labelIds?: string[];
}

/** One entry of users.history.list. Each change type is present only when it happened. */
export interface HistoryRecord {
  id: string;
  messagesAdded?: { message: HistoryMessage }[];
  messagesDeleted?: { message: HistoryMessage }[];
  labelsAdded?: { message: HistoryMessage; labelIds: string[] }[];
  labelsRemoved?: { message: HistoryMessage; labelIds: string[] }[];
}

export interface HistoryChanges {
  /** New messages and their labels when they arrived. */
  added: Map<string, string[]>;
  /** Messages whose labels changed, with their labels after the last change (null if Gmail did not say). */
  relabelled: Map<string, string[] | null>;
  /** Messages deleted for good, or emptied from the bin. */
  deleted: Set<string>;
}

/**
 * Folds a page of history into the latest state per message. Records are oldest first, so a later
 * change replaces an earlier one, and a message deleted after it was added is only reported as deleted.
 */
export function historyChanges(records: HistoryRecord[]): HistoryChanges {
  const out: HistoryChanges = { added: new Map(), relabelled: new Map(), deleted: new Set() };
  for (const record of records) {
    for (const { message } of record.messagesAdded ?? []) {
      out.added.set(message.id, message.labelIds ?? []);
      out.deleted.delete(message.id);
    }
    for (const change of [...(record.labelsAdded ?? []), ...(record.labelsRemoved ?? [])]) {
      const id = change.message.id;
      const labels = change.message.labelIds ?? null;
      if (out.added.has(id) && labels) out.added.set(id, labels);
      else out.relabelled.set(id, labels);
    }
    for (const { message } of record.messagesDeleted ?? []) {
      out.added.delete(message.id);
      out.relabelled.delete(message.id);
      out.deleted.add(message.id);
    }
  }
  return out;
}

/** Labels after an app action, so the stored copy matches Gmail before its history catches up. */
export function applyLabelChange(labels: string[], add: string[], remove: string[]): string[] {
  return [...new Set([...labels.filter((l) => !remove.includes(l)), ...add])];
}

/** Label changes in Gmail for one app action. Read state changes are made on some messages only. */
export function actionLabels(action: string): { add: string[]; remove: string[] } | null {
  switch (action) {
    case "read": return { add: [], remove: ["UNREAD"] };
    case "unread": return { add: ["UNREAD"], remove: [] };
    case "archive": return { add: [], remove: ["INBOX"] };
    case "unarchive": return { add: ["INBOX"], remove: [] };
    // Delete in the app moves the mail to Gmail's Bin, never deletes it for good.
    case "trash": return { add: ["TRASH"], remove: [] };
    case "untrash": return { add: [], remove: ["TRASH"] };
    case "spam": return { add: ["SPAM"], remove: ["INBOX"] };
    case "unspam": return { add: ["INBOX"], remove: ["SPAM"] };
    default: return null;
  }
}

export interface PlacedMessage {
  labels: string[];
  direction: string;
  /** Deleted for good in Gmail. */
  deleted?: boolean;
}

/** Where a conversation is in Gmail. "gone" means none of its messages is left there. */
export type GmailPlace = "inbox" | "archived" | "trash" | "spam" | "gone";

/**
 * In the Inbox while any message is (and not in the Bin or Spam). Otherwise it is in the Bin or Spam
 * when every message from other people is, so a reply you sent that stays in Sent does not hold it back.
 * A conversation of only your own messages goes by those instead.
 */
export function threadPlace(messages: PlacedMessage[]): GmailPlace {
  const live = messages.filter((m) => !m.deleted);
  if (live.length === 0) return "gone";
  if (live.some((m) => m.labels.includes("INBOX") && !hidden(m.labels))) return "inbox";
  const inbound = live.filter((m) => m.direction === "inbound");
  const judged = inbound.length > 0 ? inbound : live;
  if (judged.every((m) => m.labels.includes("TRASH"))) return "trash";
  if (judged.every((m) => m.labels.includes("SPAM") || m.labels.includes("TRASH"))) return "spam";
  return "archived";
}
