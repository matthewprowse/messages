// Zoom Team Chat, 1:1 and group chats, as conversations on channel 'zoom'. There is no public endpoint for
// Zoom's webhooks, so this polls: the chat sessions with a message since the last poll, then the messages in
// each. Each message is stored through public.ingest_zoom_chat, which files it like ingest_whatsapp does (one
// conversation per chat, matched on the chat's blind index) and matches people by email, like ingest_email.
//
// A 1:1 chat is keyed by the other person's email (or Zoom ID when there is none), a group chat by its channel
// ID; sending uses the same value as to_contact or to_channel. The database and sealing come in through
// interfaces, so the mapping and the sync can be unit tested on recorded Zoom replies (chat.test.ts).

import type { Json } from "@messages/db";
import { FIELD, type Field } from "@messages/crypto/fields";
import { errorCode, log } from "../log";
import { ZoomApiError, type ZoomApi } from "./client";

const PAGE_SIZE = 50;
/** Each poll reads a little further back than the last one, so a message stamped just before it is not missed. */
export const OVERLAP_MS = 2 * 60_000;
const PREVIEW_CHARS = 160;

export interface ZoomChatSession {
  type: "1:1" | "groupchat";
  name?: string;
  channel_id?: string;
  peer_contact_email?: string;
  peer_contact_user_id?: string;
  peer_contact_member_id?: string;
  last_message_sent_time?: string;
}

export interface ZoomChatFile {
  file_id?: string;
  file_name?: string;
  file_size?: number;
}

export interface ZoomChatMessage {
  id: string;
  message?: string;
  /** The sender's email. */
  sender?: string;
  sender_display_name?: string;
  date_time?: string;
  /** Milliseconds since 1970. */
  timestamp?: number;
  message_type?: string;
  reply_main_message_id?: string;
  files?: ZoomChatFile[];
  file_name?: string;
  bot_message?: unknown;
}

interface SessionsPage {
  sessions?: ZoomChatSession[];
  next_page_token?: string;
}

interface MessagesPage {
  messages?: ZoomChatMessage[];
  next_page_token?: string;
}

/** A chat as this connector keys it: the value Zoom takes as to_contact (1:1) or to_channel (group). */
export interface ChatRef {
  id: string;
  isGroup: boolean;
  /** The group's name, or the other person's in a 1:1 chat. */
  name: string | null;
  /** The other person's email in a 1:1 chat. */
  peerEmail: string | null;
}

/** The chat a session is, or null for one that cannot be addressed. */
export function chatRef(session: ZoomChatSession): ChatRef | null {
  const name = session.name?.trim() || null;
  if (session.type === "groupchat") return session.channel_id ? { id: session.channel_id, isGroup: true, name, peerEmail: null } : null;
  const email = session.peer_contact_email?.trim().toLowerCase() || null;
  const id = email ?? (session.peer_contact_user_id || session.peer_contact_member_id || null);
  return id ? { id, isGroup: false, name, peerEmail: email } : null;
}

/** Sealing and blind indexes for stored text, addresses and chat IDs (vault.ts and @messages/crypto in the worker). */
export interface ChatSealer {
  seal(field: Field, value: string | null): Promise<string | null>;
  sealAddress(value: string | null): Promise<string | null>;
  addressIndex(value: string): Promise<string>;
  chatIndex(value: string): Promise<string>;
}

/** What public.ingest_zoom_chat returns for one message. */
export type ZoomChatStored = { result: "inserted" | "updated"; message_id?: string; thread_id?: string };

export interface ChatStore {
  ingest(payload: Json): Promise<ZoomChatStored>;
}

export interface ChatContext {
  /** Your Zoom email, to tell your messages from theirs. */
  selfEmail: string;
  /** For logs. */
  accountId?: string;
}

export function oneLine(text: string, max = PREVIEW_CHARS): string {
  const line = text.replace(/\s+/g, " ").trim();
  return line.length > max ? `${line.slice(0, max - 1).trimEnd()}…` : line;
}

/** The text a message stores: what was written, then a line per file it carries (the files stay in Zoom). */
export function messageText(message: ZoomChatMessage): string {
  const names = (message.files?.length ? message.files.map((f) => f.file_name) : [message.file_name]).filter((n): n is string => !!n?.trim());
  return [message.message?.trim() ?? "", ...names.map((n) => `File: ${n.trim()}`)].filter(Boolean).join("\n");
}

/** When a message was sent. */
export function sentAt(message: ZoomChatMessage): Date {
  if (typeof message.timestamp === "number" && message.timestamp > 0) return new Date(message.timestamp);
  const parsed = Date.parse(message.date_time ?? "");
  return Number.isFinite(parsed) ? new Date(parsed) : new Date();
}

/**
 * One message as public.ingest_zoom_chat takes it, or null for one with nothing to show (an app's card with no
 * text). `live` is true for a message that arrived since the last poll: one from someone else is then unread.
 */
export async function chatPayload(message: ZoomChatMessage, chat: ChatRef, ctx: ChatContext, sealer: ChatSealer, live: boolean): Promise<Json | null> {
  const body = messageText(message);
  if (!message.id || !body) return null;
  const senderEmail = message.sender?.trim().toLowerCase() || null;
  const fromMe = !!senderEmail && senderEmail === ctx.selfEmail.trim().toLowerCase();
  const senderName = message.sender_display_name?.trim() || (!chat.isGroup ? chat.name : null) || senderEmail;
  const person = async (email: string, name: string | null) => ({
    address: await sealer.sealAddress(email),
    index: await sealer.addressIndex(email),
    display_name: name,
  });
  const sender = !fromMe && senderEmail ? await person(senderEmail, senderName) : null;
  const participants = !chat.isGroup && chat.peerEmail ? [await person(chat.peerEmail, chat.name)] : [];
  const preview = chat.isGroup && !fromMe && senderName ? `${senderName}: ${body}` : body;
  const unread = live && !fromMe;
  return {
    provider_message_id: message.id,
    chat_id: await sealer.sealAddress(chat.id),
    chat_index: await sealer.chatIndex(chat.id),
    is_group: chat.isGroup,
    group_name: chat.isGroup ? chat.name : null,
    resurface: unread,
    sent_at: sentAt(message).toISOString(),
    direction: fromMe ? "outbound" : "inbound",
    is_read: !unread,
    sender,
    sender_address: fromMe ? null : await sealer.sealAddress(senderEmail),
    sender_index: !fromMe && senderEmail ? await sealer.addressIndex(senderEmail) : null,
    participants,
    preview: await sealer.seal(FIELD.preview, oneLine(preview)),
    body_text: await sealer.seal(FIELD.body, body),
    provider_meta: {
      chat: await sealer.sealAddress(chat.id),
      from_me: fromMe,
      ...(message.reply_main_message_id ? { reply_main: message.reply_main_message_id } : {}),
      ...(message.message_type ? { type: message.message_type } : {}),
    },
  };
}

/** A time as Zoom's chat APIs take it: yyyy-MM-ddTHH:mm:ssZ. */
export const zoomTime = (d: Date) => `${d.toISOString().slice(0, 19)}Z`;

export class ChatSync {
  constructor(
    private readonly api: ZoomApi,
    private readonly store: ChatStore,
    private readonly sealer: ChatSealer,
    private readonly ctx: ChatContext,
  ) {}

  /**
   * Stores the messages of every chat with one since `since`, oldest first in each chat. `live` is false for
   * the first sync, whose messages arrive read. Returns how many new messages were stored.
   */
  async sync(since: Date, until: Date, live: boolean): Promise<number> {
    const from = new Date(since.getTime() - OVERLAP_MS);
    let inserted = 0;
    for (const session of await this.sessions(from, until)) {
      const chat = chatRef(session);
      if (!chat) continue;
      let messages: ZoomChatMessage[];
      try {
        messages = await this.messages(chat, from, until);
      } catch (err) {
        // One chat Zoom will not show (a contact since removed, a channel you left) must not hold up the rest.
        // Throttling and anything that is not Zoom's refusal stop the poll, which starts again from the same point.
        if (!(err instanceof ZoomApiError) || err.status === 429 || err.status >= 500) throw err;
        log.warn("zoom chat skipped", { account: this.ctx.accountId, code: errorCode(err) });
        continue;
      }
      for (const message of messages) {
        const payload = await chatPayload(message, chat, this.ctx, this.sealer, live);
        if (!payload) continue;
        if ((await this.store.ingest(payload)).result === "inserted") inserted++;
      }
    }
    return inserted;
  }

  /** The chats with a message in the window. Zoom does not always apply from and to here, so they are checked too. */
  private async sessions(from: Date, until: Date): Promise<ZoomChatSession[]> {
    const out: ZoomChatSession[] = [];
    let token: string | undefined;
    do {
      const page: SessionsPage = await this.api.request("/chat/users/me/sessions", {
        query: { page_size: PAGE_SIZE, from: zoomTime(from), to: zoomTime(until), next_page_token: token },
      });
      for (const s of page.sessions ?? []) {
        const last = Date.parse(s.last_message_sent_time ?? "");
        if (!Number.isFinite(last) || last >= from.getTime()) out.push(s);
      }
      token = page.next_page_token || undefined;
    } while (token);
    return out;
  }

  /** One chat's messages in the window, oldest first. */
  async messages(chat: ChatRef, from: Date, until: Date): Promise<ZoomChatMessage[]> {
    const out: ZoomChatMessage[] = [];
    let token: string | undefined;
    do {
      const page: MessagesPage = await this.api.request("/chat/users/me/messages", {
        query: {
          [chat.isGroup ? "to_channel" : "to_contact"]: chat.id,
          from: zoomTime(from),
          to: zoomTime(until),
          page_size: PAGE_SIZE,
          next_page_token: token,
        },
      });
      out.push(...(page.messages ?? []));
      token = page.next_page_token || undefined;
    } while (token);
    return out.sort((a, b) => sentAt(a).getTime() - sentAt(b).getTime());
  }
}

/** The request body that sends a reply into a chat, as a thread reply when it answers one. */
export function sendBody(chat: Pick<ChatRef, "id" | "isGroup">, text: string, replyMain: string | null): Record<string, string> {
  return {
    message: text,
    [chat.isGroup ? "to_channel" : "to_contact"]: chat.id,
    ...(replyMain ? { reply_main_message_id: replyMain } : {}),
  };
}
