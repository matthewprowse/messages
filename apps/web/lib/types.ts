import type { ChoiceKind } from "./choices";
import type { Emphasis, ForwardedEmail } from "./email-text";

/** A guided drafting choice you picked: what the draft says, and the kind of answer it is. */
export interface Decision {
  text: string;
  kind: ChoiceKind;
}
export type Channel = "email" | "whatsapp";
export type Provider = "icloud" | "gmail" | "whatsapp" | "google_calendar";
export type Priority = "urgent" | "important" | "normal" | "low";
export type Category = "personal" | "work" | "needs_reply" | "fyi" | "newsletter" | "notification";
export type ThreadStatus = "inbox" | "archived" | "trash";
export type View = "priority" | "all" | "junk" | "subscriptions";
export type ListFilter = "none" | "unread" | "email" | "whatsapp";
export type AccountStatus = "connecting" | "syncing" | "connected" | "disconnected" | "error";

export interface Contact {
  id: string;
  name: string;
  initials: string;
  hue: number;
  emails: string[];
  phones: string[];
  company?: string;
  role?: string;
  /** Their photo in the private avatars bucket, from your address book or WhatsApp. */
  avatarPath?: string;
}

export interface Attachment {
  id: string;
  name: string;
  kind: "image" | "pdf" | "video" | "file";
  size: string;
  path?: string; // where the file is stored in the private attachments bucket, once it is
  hiddenReason?: "inline" | "tiny" | "junk" | "manual"; // set for files kept out of the attachment lists
}

/** An attachment with the message it came with, for views that gather files from many messages. */
export interface FiledAttachment extends Attachment {
  messageId: string;
  threadId: string;
  sentAt: string;
  from: string; // contact id or "me"
}

export interface Message {
  id: string;
  /** The provider's own message ID, which a WhatsApp quote points at. */
  providerId?: string;
  threadId: string;
  from: string; // contact id or "me"
  /** The address or number it came from. On your own emails, the address it went out from. */
  address?: string;
  /** Lowercase To and Cc addresses of an email, used to pick the From address of a reply. */
  toAddresses?: string[];
  sentAt: string;
  body: string;
  /** Quoted history and signature split off an email body, shown on request. */
  quoted?: string;
  /** Newsletter or marketing mail, worked out once when the message is loaded. */
  bulk?: boolean;
  /** A forwarded email, shown in its own card under the forwarder's note (body). */
  forward?: ForwardedEmail;
  /** The bold and italic runs of an email's HTML, found again in body when it is drawn. */
  marks?: Emphasis[];
  /** A WhatsApp message: body is its text as sent, with WhatsApp's formatting markers. */
  whatsapp?: boolean;
  /** The email has an HTML version, which View Original fetches from the provider when opened. */
  hasOriginal?: boolean;
  attachments?: Attachment[];
  /** The message a WhatsApp reply quotes, as it was when quoted. */
  quote?: { id: string; author: string; fromMe: boolean; text: string };
  /** WhatsApp reactions by who reacted: "me", a phone number or a privacy ID, to the emoji. */
  reactions?: Record<string, string>;
  /** A WhatsApp message deleted by its sender. */
  deleted?: boolean;
  /** A WhatsApp message changed by its sender after it was sent. */
  edited?: boolean;
  /** Set on a reply you just sent until the real message arrives from the mail server. */
  sendState?: "sending" | "failed";
  sendError?: string;
}

export interface Draft {
  id: string;
  body: string;
  tone: "default" | "shorter" | "formal" | "casual" | "custom";
  instruction?: string;
  /** What you decided with a guided drafting choice, kept when you ask for another tone. */
  decision?: Decision;
  generatedAt: string;
}

export interface Thread {
  id: string;
  accountId?: string;
  channel: Channel;
  provider: Provider;
  subject?: string;
  participantIds: string[];
  isGroup?: boolean;
  groupName?: string;
  /** A WhatsApp group's picture in the private avatars bucket. */
  avatarPath?: string;
  /** The title when the conversation has no saved person: a WhatsApp chat's number. */
  fallbackName?: string;
  lastMessageAt: string;
  /** One-line preview of the latest message, stored by the sync worker. */
  preview?: string;
  unread: boolean;
  unreadCount: number;
  pinned: boolean;
  status: ThreadStatus;
  priority: Priority;
  category: Category;
  summary: string;
  needsReply: boolean;
  /** Spam, marketing or impersonal bulk mail, kept out of All and Priority. */
  junk: boolean;
  /** Offers a way to unsubscribe. Junk that does is shown under Subscriptions, the rest under Junk. */
  subscription: boolean;
  draft?: Draft;
  feedback?: "important" | "not_important";
}

/** A request to stop mail from one sender, carried out by the sync worker. */
export interface Unsubscribe {
  id: string;
  accountId: string;
  sender: string;
  status: "queued" | "working" | "done" | "manual" | "failed";
  /** A page to open yourself, when the sender offers no automatic way. */
  manualUrl?: string;
  error?: string;
}

export interface Account {
  id: string;
  provider: Provider;
  label: string;
  detail: string;
  status: AccountStatus;
  statusDetail?: string;
  lastSync?: string;
  /** Every address the account can send from. Gmail fills it from its settings, iCloud from the app. */
  sendAddresses: string[];
}

export interface Rule {
  id: string;
  kind: "always_important" | "never_important";
  target: string;
}

export interface WritingExample {
  id: string;
  text: string;
  context: string;
}

export interface Profile {
  name: string;
  about: string;
  people: string;
  quietStart: string;
  quietEnd: string;
  pushUrgent: boolean;
  pushImportant: boolean;
  autoDraftTop: boolean;
  whatsappReadReceipts: boolean;
}
