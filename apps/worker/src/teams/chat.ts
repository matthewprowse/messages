// Teams chats and messages from Microsoft Graph, turned into what the app stores, and replies turned into
// what Graph takes. Pure apart from postReply, which only calls the client it is given, so it can all be
// unit tested.

import { emphasisRuns, htmlToText, type Emphasis } from "@messages/email-text";
import { GraphApiError, signInRevoked, type GraphClient } from "../microsoft/client";
import { MicrosoftAuthError } from "../microsoft/oauth";

export interface GraphIdentity {
  id?: string | null;
  displayName?: string | null;
  userIdentityType?: string | null;
}

export interface GraphAttachment {
  id?: string | null;
  /** "reference" for a shared file, "messageReference" for a quoted message, a card's own type for cards. */
  contentType?: string | null;
  contentUrl?: string | null;
  content?: string | null;
  name?: string | null;
}

export interface GraphChatMessage {
  id: string;
  /** "message" for what people write; system events (someone added, the meeting started) have their own. */
  messageType?: string | null;
  createdDateTime?: string | null;
  lastModifiedDateTime?: string | null;
  lastEditedDateTime?: string | null;
  deletedDateTime?: string | null;
  from?: { user?: GraphIdentity | null; application?: GraphIdentity | null } | null;
  body?: { contentType?: string | null; content?: string | null } | null;
  attachments?: GraphAttachment[] | null;
  reactions?: { reactionType?: string | null; displayName?: string | null; user?: { user?: GraphIdentity | null } | null }[] | null;
}

export interface GraphChat {
  id: string;
  topic?: string | null;
  /** "oneOnOne", "group" or "meeting". */
  chatType?: string | null;
  /** When the chat was renamed or its members changed. */
  lastUpdatedDateTime?: string | null;
  viewpoint?: { isHidden?: boolean | null; lastMessageReadDateTime?: string | null } | null;
  lastMessagePreview?: { id?: string | null; createdDateTime?: string | null } | null;
}

export interface GraphMember {
  id?: string | null;
  displayName?: string | null;
  userId?: string | null;
  email?: string | null;
  tenantId?: string | null;
}

/** A chat member as the connector keeps them: their Entra user ID, name and work address. */
export interface Member {
  userId: string;
  name: string | null;
  email: string | null;
  tenantId: string | null;
}

export function memberOf(m: GraphMember): Member | null {
  if (!m.userId) return null;
  const email = (m.email ?? "").trim().toLowerCase();
  return { userId: m.userId, name: m.displayName?.trim() || null, email: email.includes("@") ? email : null, tenantId: m.tenantId ?? null };
}

/** Group and meeting chats are groups; a one-to-one chat is with one person. */
export function isGroupChat(chat: GraphChat): boolean {
  return chat.chatType !== "oneOnOne";
}

/** A message's ID as stored. Teams' own IDs are unique only within a chat, so the chat's index goes first. */
export function storedMessageId(chatIndex: string, messageId: string): string {
  return `teams:${chatIndex}:${messageId}`;
}

/** When a chat last had a message, or 0 when it never has. */
export function lastActivity(chat: GraphChat): number {
  const at = Date.parse(chat.lastMessagePreview?.createdDateTime ?? "");
  return Number.isFinite(at) ? at : 0;
}

/**
 * Of one page of /me/chats, newest message first: the chats with a message after `since`, and whether the
 * next page may have more (every chat on this one was new).
 */
export function changedChats(page: GraphChat[], since: number, hasNext: boolean): { changed: GraphChat[]; more: boolean } {
  const changed = page.filter((chat) => lastActivity(chat) > since);
  return { changed, more: hasNext && page.length > 0 && changed.length === page.length };
}

/**
 * Whether an incoming message counts as read: Teams' own read point for the chat decides when it has one.
 * Without one, history from the first sync is read and anything newer is not.
 */
export function inboundRead(createdAt: string, chat: GraphChat, history: boolean): boolean {
  const until = Date.parse(chat.viewpoint?.lastMessageReadDateTime ?? "");
  if (!Number.isFinite(until)) return history;
  return Date.parse(createdAt) <= until;
}

/** Graph's time format for a filter, without milliseconds. */
export function graphTime(ms: number): string {
  return new Date(ms).toISOString().replace(/\.\d{3}Z$/, "Z");
}

/** One line for previews, like WhatsApp's. */
export function oneLine(text: string, max = 160): string {
  const line = text.replace(/\s+/g, " ").trim();
  return line.length > max ? `${line.slice(0, max - 1).trimEnd()}…` : line;
}

export const DELETED = "This message was deleted.";

/** A quoted message, as Teams attaches it to a reply. */
export interface QuotedMessage {
  id: string;
  authorId: string | null;
  author: string | null;
  text: string;
}

export interface MessageContent {
  text: string;
  /** The bold, italic and code runs of the HTML, as email keeps them, since the HTML is not stored. */
  marks: Emphasis[];
  preview: string;
  deleted: boolean;
  edited: boolean;
  quoted: QuotedMessage | null;
}

/** Teams' HTML made plain for htmlToText: emoji become themselves and quote placeholders go. */
function plainerHtml(html: string): string {
  return html
    .replace(/<emoji\b[^>]*?\balt="([^"]*)"[^>]*>(?:\s*<\/emoji>)?/gi, "$1")
    .replace(/<img\b[^>]*?itemtype="[^"]*Emoji"[^>]*>/gi, (tag) => /\balt="([^"]*)"/i.exec(tag)?.[1] ?? "")
    .replace(/<attachment\b[^>]*>\s*<\/attachment>/gi, "");
}

function quotedOf(attachment: GraphAttachment | undefined): QuotedMessage | null {
  if (!attachment?.content) return null;
  try {
    const ref = JSON.parse(attachment.content) as {
      messageId?: string;
      messagePreview?: string;
      messageSender?: { user?: GraphIdentity | null; application?: GraphIdentity | null } | null;
    };
    const id = ref.messageId ?? attachment.id;
    if (!id) return null;
    const who = ref.messageSender?.user ?? ref.messageSender?.application ?? null;
    return { id, authorId: ref.messageSender?.user?.id ?? null, author: who?.displayName?.trim() || null, text: oneLine(ref.messagePreview ?? "", 300) };
  } catch {
    return null;
  }
}

/**
 * What a message says, as stored: its text from the HTML (the HTML itself is not kept, as for email), shared
 * files named on their own lines, and the message it quotes. Null for system events and anything with
 * nothing to show.
 */
export function messageContent(msg: GraphChatMessage): MessageContent | null {
  if (msg.messageType && msg.messageType !== "message") return null;
  const edited = !!msg.lastEditedDateTime;
  if (msg.deletedDateTime) return { text: DELETED, marks: [], preview: DELETED, deleted: true, edited: false, quoted: null };

  const attachments = msg.attachments ?? [];
  const raw = msg.body?.content ?? "";
  let text = "";
  let marks: Emphasis[] = [];
  let image = false;
  if ((msg.body?.contentType ?? "").toLowerCase() === "html") {
    const html = plainerHtml(raw);
    text = htmlToText(html);
    marks = emphasisRuns(html);
    image = /<img\b/i.test(html);
  } else {
    text = raw.trim();
  }
  const files = attachments.filter((a) => a.contentType === "reference" && a.name).map((a) => `File: ${a.name}`);
  const card = attachments.some((a) => a.contentType?.startsWith("application/vnd.microsoft.card."));
  let body = [text, ...files].filter(Boolean).join("\n");
  if (!body) body = image ? "Photo" : card ? "Card" : "";
  if (!body) return null;
  return {
    text: body,
    marks,
    preview: oneLine(body),
    deleted: false,
    edited,
    quoted: quotedOf(attachments.find((a) => a.contentType === "messageReference")),
  };
}

const REACTIONS: Record<string, string> = { like: "👍", heart: "❤️", laugh: "😆", surprised: "😮", sad: "😢", angry: "😡" };

/** Who reacted with what. Teams' six classic reactions have names; newer ones are the emoji itself. */
export function reactionsOf(msg: GraphChatMessage): { userId: string; emoji: string }[] {
  const out: { userId: string; emoji: string }[] = [];
  for (const r of msg.reactions ?? []) {
    const userId = r.user?.user?.id;
    const type = r.reactionType?.trim() ?? "";
    const emoji = REACTIONS[type.toLowerCase()] ?? (/[^\x00-\x7f]/.test(type) ? type : null);
    if (userId && emoji) out.push({ userId, emoji });
  }
  return out;
}

/** A reply as Teams HTML: the text escaped, its lines kept. */
export function teamsHtml(text: string): string {
  const escaped = text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  return escaped.trim().split(/\r?\n/).join("<br>");
}

/** Posts a reply to a chat and returns the message Teams made of it. */
export function postReply(client: Pick<GraphClient, "request">, chatId: string, text: string): Promise<GraphChatMessage> {
  return client.request<GraphChatMessage>(`/chats/${encodeURIComponent(chatId)}/messages`, {
    method: "POST",
    body: { body: { contentType: "html", content: teamsHtml(text) } },
    timeoutMs: 60_000,
  });
}

/** Tells Teams you read a chat, as opening it in Teams does. */
export function markChatRead(client: Pick<GraphClient, "request">, chatId: string, me: { userId: string; tenantId: string }): Promise<void> {
  return client.request<void>(`/chats/${encodeURIComponent(chatId)}/markChatReadForUser`, {
    method: "POST",
    body: { user: { id: me.userId, tenantId: me.tenantId } },
  });
}

/**
 * Why a reply did not go, for the outbox row. Once the request was made, an answer that never came back
 * (a timeout, a dropped connection, a server error) may still mean it went out.
 */
export function sendFailure(err: unknown, requested: boolean): string {
  if (signInRevoked(err)) return "Microsoft sign-in expired, so the message was not sent. Run pnpm connect:microsoft to reconnect, then send again.";
  if (err instanceof GraphApiError) {
    if (err.status === 403) return "Teams would not send this message. You may no longer be in this chat.";
    if (err.status === 404) return "This Teams chat no longer exists, so the message was not sent.";
    if (err.status === 413) return "Teams refused the message because it is too long.";
    if (err.status >= 500) return "The message may have been sent. Check Teams before sending again.";
    return "The message could not be sent. Try again.";
  }
  if (requested && !(err instanceof MicrosoftAuthError)) return "The message may have been sent. Check Teams before sending again.";
  return "The message could not be sent. Try again.";
}

/** Shown in Settings when Microsoft needs an IT admin before Teams can be read. */
export const ADMIN_APPROVAL =
  "Your organisation's IT admin needs to approve Teams access for Messages. Ask them to grant admin consent in Microsoft Entra, then run pnpm connect:microsoft again.";

/**
 * The account status for a session failure that only you or your IT admin can fix, or null when it is
 * worth retrying. `listing` is true for the chat list itself: a refusal there means Teams as a whole.
 */
export function teamsAccessProblem(err: unknown, listing: boolean): string | null {
  if (err instanceof MicrosoftAuthError && err.code === "consent_required") return ADMIN_APPROVAL;
  if (listing && err instanceof GraphApiError && (err.status === 401 || err.status === 403)) {
    return "Microsoft would not open your Teams chats. Teams needs a work or school account, and your organisation's IT admin may need to approve Messages first. Then run pnpm connect:microsoft again.";
  }
  return null;
}
