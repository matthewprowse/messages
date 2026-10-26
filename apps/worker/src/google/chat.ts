// Google Chat through the Chat API (chat.googleapis.com/v1), signed in as you. Each direct message, group
// chat and named space is one conversation, channel "google_chat", stored the way WhatsApp chats are. This
// file is the pure part: which spaces to read, what a message becomes, and what a refusal means.
// connectors/google-meet.ts does the calls.

export const CHAT_API = "https://chat.googleapis.com/v1";
/** Most messages per page Chat returns. */
export const CHAT_PAGE = 1000;

export interface ChatSpace {
  /** "spaces/{id}" */
  name: string;
  spaceType?: "SPACE" | "GROUP_CHAT" | "DIRECT_MESSAGE" | "SPACE_TYPE_UNSPECIFIED";
  /** A named space's name. Empty for direct messages and unnamed group chats. */
  displayName?: string;
  /** A direct message with a Chat app rather than a person. */
  singleUserBotDm?: boolean;
  /** When the newest message was posted. */
  lastActiveTime?: string;
}

export interface ChatUser {
  /** "users/{id}": the same ID as the People API and the OpenID sign-in's sub. */
  name?: string;
  /** Signed in as you, Google fills this in only for people you share a space or a direct message with. */
  displayName?: string;
  type?: "HUMAN" | "BOT" | "TYPE_UNSPECIFIED";
}

export interface ChatMessage {
  /** "spaces/{space}/messages/{message}" */
  name: string;
  sender?: ChatUser;
  createTime?: string;
  deleteTime?: string;
  text?: string;
  thread?: { name?: string };
  threadReply?: boolean;
  attachment?: { contentName?: string; contentType?: string }[];
  quotedMessageMetadata?: { name?: string };
}

/** A Chat message ready to store, before anything is sealed. */
export interface MappedChat {
  providerMessageId: string;
  space: string;
  isGroup: boolean;
  /** A named space's name; direct messages and group chats are named after their people. */
  groupName: string | null;
  sentAt: string;
  fromMe: boolean;
  /** "users/{id}" of who sent it, for matching them and their later messages. */
  senderUser: string | null;
  senderName: string | null;
  body: string;
  preview: string;
  thread: string | null;
  /** The message this one quotes, when it is a quoted reply. */
  quoted: string | null;
}

/** A preview line: one line, at most 160 characters, like a WhatsApp message's. */
function oneLine(text: string, max = 160): string {
  const line = text.replace(/\s+/g, " ").trim();
  return line.length > max ? `${line.slice(0, max - 1).trimEnd()}…` : line;
}

/** New messages since `since`, for spaces.messages.list. */
export function messagesFilter(since: string): string {
  return `createTime > "${since}"`;
}

/**
 * The spaces with something new since `since`: Chat says when each last had a message, so quiet ones cost
 * nothing to skip. Direct messages with Chat apps are not conversations with people and are left out.
 */
export function spacesToRead(spaces: ChatSpace[], since: string | null): ChatSpace[] {
  const after = since ? Date.parse(since) : -Infinity;
  return spaces.filter((s) => {
    if (s.singleUserBotDm) return false;
    if (s.spaceType === "SPACE_TYPE_UNSPECIFIED") return false;
    const active = s.lastActiveTime ? Date.parse(s.lastActiveTime) : NaN;
    return !Number.isFinite(active) || active > after;
  });
}

/** The text of a message, or what it carries when it has only files. Null when there is nothing to show. */
export function chatBody(message: Pick<ChatMessage, "text" | "attachment">): string | null {
  const text = message.text?.trim();
  if (text) return text;
  const files = (message.attachment ?? []).filter((a) => a.contentName || a.contentType);
  if (files.length === 1) return `Sent a file: ${files[0].contentName ?? "attachment"}`;
  if (files.length > 1) return `Sent ${files.length} files`;
  return null;
}

/**
 * What one Chat message becomes, or null for one not stored: deleted, empty, or without a sender. Yours are the
 * ones sent by your own Google ID. In a group the preview leads with who wrote, as WhatsApp's do.
 */
export function mapChatMessage(message: ChatMessage, ctx: { space: ChatSpace; selfUserId: string | null; senderName?: string | null; sentByMe?: boolean }): MappedChat | null {
  if (!message.name || message.deleteTime) return null;
  const body = chatBody(message);
  if (!body) return null;
  const senderUser = message.sender?.name ?? (ctx.sentByMe ? "users/me" : null);
  if (!senderUser) return null;
  const fromMe = !!ctx.sentByMe || (!!ctx.selfUserId && senderUser === `users/${ctx.selfUserId}`);
  const isGroup = ctx.space.spaceType !== "DIRECT_MESSAGE";
  const senderName = fromMe ? null : (ctx.senderName?.trim() || message.sender?.displayName?.trim() || null);
  const lead = isGroup && !fromMe && senderName ? `${senderName}: ` : "";
  return {
    providerMessageId: message.name,
    space: ctx.space.name,
    isGroup,
    groupName: isGroup ? ctx.space.displayName?.trim() || null : null,
    sentAt: message.createTime ? new Date(message.createTime).toISOString() : new Date().toISOString(),
    fromMe,
    senderUser,
    senderName,
    body,
    preview: oneLine(lead + body),
    thread: message.threadReply || ctx.space.spaceType === "SPACE" ? (message.thread?.name ?? null) : null,
    quoted: message.quotedMessageMetadata?.name ?? null,
  };
}

/** The Google user ID in "users/{id}". */
export function chatUserId(user: string | null | undefined): string | null {
  return user?.match(/^users\/(.+)$/)?.[1] ?? null;
}

/**
 * A reply posted as you with spaces.messages.create. The outbox row's id is the request ID, so asking again
 * after a lost answer returns the message already made instead of posting it twice. In a named space a reply to
 * a message goes in that message's thread.
 */
export function buildChatSend(opts: { space: string; text: string; requestId: string; thread?: string | null }) {
  return {
    url: `${CHAT_API}/${opts.space}/messages`,
    query: { requestId: opts.requestId, ...(opts.thread ? { messageReplyOption: "REPLY_MESSAGE_FALLBACK_TO_NEW_THREAD" } : {}) },
    body: { text: opts.text, ...(opts.thread ? { thread: { name: opts.thread } } : {}) },
  };
}

/** Chat's limit on one message, contents included. */
export const MAX_CHAT_BYTES = 32_000;

export const CHAT_APP_MISSING =
  "Google Chat needs a Chat app set up in your Google Cloud project. Open the Google Chat API's Configuration page, fill in the app's name, avatar and description, and save.";
export const CHAT_OFF =
  "Google Chat could not be read. Check that the Google Chat API is turned on in your Google Cloud project, and that your Workspace administrator has not turned Chat off for you.";
export const CHAT_NOT_GRANTED = "Google Chat access was not granted. Reconnect Google in Settings, Connected Accounts, and tick the Chat boxes.";

/**
 * Why Chat refused to be read, when it is not worth retrying soon: a Cloud project without a Chat app answers
 * 404 to every call, and Chat turned off for the account answers 403. Null for anything else.
 */
export function chatReadProblem(status: number, reason: string | null): string | null {
  if (status === 404) return CHAT_APP_MISSING;
  if (status === 403 && reason === "insufficientPermissions") return CHAT_NOT_GRANTED;
  if (status === 403) return CHAT_OFF;
  return null;
}

/** What a refused reply means. A server error may have posted it, so the person is told to look first. */
export function chatSendFailure(status: number | null, reason: string | null): string {
  if (status === null || status >= 500) return "The message may not have been sent. Check Google Chat before sending again.";
  if (status === 429 || (status === 403 && reason && /rate|quota|RESOURCE_EXHAUSTED/i.test(reason))) return "Google Chat is busy. Try again in a minute.";
  if (status === 401) return "Google sign-in expired or was removed. Reconnect Google in Settings, Connected Accounts.";
  if (status === 403) return "You cannot post in this Google Chat conversation.";
  if (status === 404) return "This Google Chat conversation no longer exists.";
  return "Google Chat did not accept this message.";
}
