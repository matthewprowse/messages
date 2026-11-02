// Shared app types: the shapes the screens read (Thread, Message, Contact, Account, Task, Profile) and the unions they use
// (Channel, Provider, Priority, Category). data.ts maps database rows into these.

import type { ChoiceKind } from "./choices";
import type { Emphasis, ForwardedEmail } from "./email-text";

/** A guided drafting choice you picked: what the draft says, and the kind of answer it is. */
export interface Decision {
  text: string;
  kind: ChoiceKind;
}
export type Channel = "email" | "whatsapp" | "linkedin" | "instagram" | "teams" | "zoom" | "google_chat";
export type Provider = "icloud" | "gmail" | "outlook" | "whatsapp" | "google_calendar" | "outlook_calendar" | "icloud_calendar" | "imap" | "teams" | "zoom" | "google_meet" | "linkedin" | "instagram" | "microsoft_todo" | "google_tasks" | "icloud_reminders";
export type Priority = "urgent" | "important" | "normal" | "low";
export type Category = "personal" | "work" | "needs_reply" | "fyi" | "newsletter" | "notification";
export type ThreadStatus = "inbox" | "archived" | "trash";
export type View = "priority" | "all" | "junk" | "subscriptions" | "archive";
export type ListFilter = "none" | "unread" | "email" | "whatsapp" | "waiting";
export type AccountStatus = "connecting" | "syncing" | "connected" | "disconnected" | "error";

export interface Contact {
  id: string;
  name: string;
  initials: string;
  hue: number;
  emails: string[];
  phones: string[];
  /** Instagram usernames, without the @. */
  handles?: string[];
  /** WhatsApp privacy IDs ("...@lid") that stand in for a hidden number, so a reaction by one can still be named. */
  lids?: string[];
  company?: string;
  role?: string;
  /** Their photo in the private avatars bucket, from your address book or WhatsApp. */
  avatarPath?: string;
  /** Writes as a company (a no-reply sender, a brand) rather than as themselves, which picks their avatar's icon. */
  isCompany: boolean;
  /** The company they write for, as grouped on the Companies tab, with its shared logo. */
  organization?: { id: string; name: string; logoPath?: string };
}

export interface Attachment {
  id: string;
  name: string;
  kind: "image" | "pdf" | "video" | "audio" | "file";
  size: string;
  /** The file's size in bytes, for totals. */
  bytes?: number;
  path?: string; // where the file is stored in the private attachments bucket, once it is
  hiddenReason?: "inline" | "tiny" | "junk" | "manual"; // set for files kept out of the attachment lists
  thumbPath?: string; // a sealed 256 px thumbnail of a photo, which grid tiles open instead of the whole file
  sealed?: boolean; // the stored file is encrypted: it is opened in the browser, not shown from a signed link
  notKept?: "video_link" | "over_cap" | "deferred" | "unavailable"; // why no copy was made: a video left at the provider, the storage is full, an old or large email file fetched when opened, or one the mailbox no longer has
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
  /** What was said in a WhatsApp voice note, for View Transcript. */
  transcript?: string;
  /** A WhatsApp message: body is its text as sent, with WhatsApp's formatting markers. */
  whatsapp?: boolean;
  /** The email has an HTML version, which View Original fetches from the provider when opened. */
  hasOriginal?: boolean;
  /** Bulk mail older than 30 days is cut down to a short preview; the full email is still one View Original away. */
  bodyShrunk?: boolean;
  attachments?: Attachment[];
  /** The message a WhatsApp reply quotes, as it was when quoted. */
  quote?: { id: string; author: string; fromMe: boolean; text: string };
  /** WhatsApp reactions by who reacted: "me", a phone number or a privacy ID, to the emoji. */
  reactions?: Record<string, string>;
  /** A WhatsApp message deleted by its sender. */
  deleted?: boolean;
  /** A WhatsApp message changed by its sender after it was sent. */
  edited?: boolean;
  /** How far a WhatsApp message you sent has got: WhatsApp's one tick, two ticks, two blue ticks. */
  receipt?: "sent" | "delivered" | "read";
  /** Set on a reply you just sent until the real message arrives from the mail server. */
  sendState?: "sending" | "failed";
  sendError?: string;
}

export interface Draft {
  id: string;
  body: string;
  /** edit: your own text, lightly corrected by the AI rather than written by it. */
  tone: "default" | "shorter" | "formal" | "casual" | "custom" | "edit";
  instruction?: string;
  /** What you wrote before an edit, for Undo Edit. */
  source?: string;
  /** What you decided with a guided drafting choice, kept when you ask for another tone. */
  decision?: Decision;
  /** Written before you asked (a pre-draft), so it never replaces what you are typing. */
  auto?: boolean;
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
  /** The latest message is yours, so the conversation waits on them, not you. */
  lastFromMe: boolean;
  /** Who sent the latest message, so a group's row can say who it was. */
  lastSenderId?: string;
  /** That message of yours expects an answer (a question, a request, documents sent), as the AI read it. */
  waiting?: boolean;
  /** Spam, marketing or impersonal bulk mail, kept out of All and Priority. */
  junk: boolean;
  /** Offers a way to unsubscribe. Junk that does is shown under Subscriptions, the rest under Junk. */
  subscription: boolean;
  /** The team this is a work chat of; none for a personal chat (see lib/share.ts). */
  workspaceId?: string;
  /** How a work chat became one: a rule, a suggestion the agent accepted, the agent, or a team account. */
  sharedBy?: "rule" | "suggestion" | "agent" | "account";
  /** The client or client company a rule matched (a shared chat) or a suggestion rests on, opened with the team's key. */
  shareMatch?: string;
  /** Konva thinks this personal chat is about work; only its agent sees it (see lib/share.ts). */
  shareSuggestion?: "suggested";
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
  /** A name the person gave it. Shown beside the logo only when they have several accounts of one service. */
  nickname?: string;
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
  /** Path of your own photo in the avatars bucket, or null while you have none. */
  avatarPath: string | null;
  about: string;
  people: string;
  quietStart: string;
  quietEnd: string;
  pushUrgent: boolean;
  pushImportant: boolean;
  autoDraftTop: boolean;
  whatsappReadReceipts: boolean;
  /** Send content-free usage numbers (which screens and features are used, never any text) to improve the product. */
  shareUsage: boolean;
  /** What the AI writes summaries in: a language code, or null to follow how you write. */
  language: "en-GB" | "en-US" | "af" | null;
}

/** A task or reminder from Microsoft To Do, Google Tasks or iCloud Reminders, shown in Calendar on the day it is due. */
export interface Task {
  id: string;
  accountId: string;
  title: string;
  notes?: string;
  /** The list it is in, such as "Clients". */
  listName?: string;
  /** A due time, or midnight UTC of the due date when dueAllDay. Null when it has no date. */
  dueAt: string | null;
  dueAllDay: boolean;
  completed: boolean;
  completedAt?: string;
  /** 1 high, 2 medium, 3 low. */
  priority?: 1 | 2 | 3;
  /** The client it is about, when it could be matched. */
  contactId?: string;
  /** Ticked or unticked here and not yet made at the provider. */
  pending?: boolean;
}
