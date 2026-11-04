// LinkedIn conversations and messages, as the helper reports them, turned into what public.ingest_linkedin
// stores: the payload of public.ingest_whatsapp with chat_id for chat_jid, and people as public.linkedin_contact
// takes them. A person's profile URN is their contact identity; a conversation's URN is its thread ID. Pure
// apart from the sealer, so it can be unit tested on hand-written data.

import { FIELD, type Field } from "@messages/crypto/fields";
import { oneLine } from "../whatsapp/normalize";
import { REAL_NAME, STAND_IN, type NameRank } from "../contacts/name-rank";
import type { LinkedInConversation, LinkedInFile, LinkedInMessage, LinkedInPerson } from "./helper";

export const DELETED_TEXT = "This message was deleted.";
const PLACEHOLDER_NAME = "LinkedIn Member";

/** Sealing and blind indexes for one user, as the vault does them. */
export interface Sealer {
  text(field: Field, value: string | null): Promise<string | null>;
  address(value: string | null): Promise<string | null>;
  addressIndex(value: string): Promise<string>;
  chatIndex(value: string): Promise<string>;
  /** A group's name index (threads.group_name_index). */
  groupIndex(value: string): Promise<string>;
}

export function personName(p: LinkedInPerson): string {
  const name = p.kind === "organization" ? (p.name ?? "") : [p.firstName, p.lastName].filter(Boolean).join(" ");
  return name.trim() || PLACEHOLDER_NAME;
}

/** Everyone in a conversation but you. */
export function others(conv: LinkedInConversation, meId: string): LinkedInPerson[] {
  return conv.participants.filter((p) => p.id !== meId);
}

/** Conversations never stored: spam, and ones you are no longer in. */
export function skipConversation(conv: LinkedInConversation, meId: string): boolean {
  if (conv.categories?.includes("SPAM")) return true;
  return conv.participants.length > 0 && !conv.participants.some((p) => p.id === meId);
}

export function isGroup(conv: LinkedInConversation, meId: string): boolean {
  return conv.group || others(conv, meId).length > 1;
}

/** A conversation for a message whose conversation is not known yet: you and its sender. */
export function stubConversation(m: LinkedInMessage, me: LinkedInPerson): LinkedInConversation {
  return {
    urn: m.conversationUrn,
    group: false,
    read: false,
    lastActivityAt: m.deliveredAt,
    participants: m.sender && m.sender.id !== me.id ? [me, m.sender] : [me],
  };
}

/** What a message says, or null for one that is not stored (LinkedIn's own notices, empty ones). */
export function messageText(m: LinkedInMessage): { text: string; deleted: boolean } | null {
  if (m.format === "SYSTEM") return null;
  if (m.format === "RECALLED") return { text: DELETED_TEXT, deleted: true };
  const text = m.text ?? "";
  if (!text.trim() && !(m.files?.length)) return null;
  return { text, deleted: false };
}

/**
 * Which of a conversation's messages are unread: those from someone else delivered after you last read it,
 * when LinkedIn says it is unread. Live messages from someone else are always unread.
 */
export function unreadUrns(conv: LinkedInConversation, messages: LinkedInMessage[], meId: string): Set<string> {
  if (conv.read) return new Set();
  const after = conv.lastReadAt ?? 0;
  return new Set(messages.filter((m) => m.sender?.id !== meId && m.deliveredAt > after).map((m) => m.urn));
}

/**
 * When the other person has seen a one-to-one conversation, in Unix milliseconds, so your messages up to then
 * show as seen. Null for a group (who has seen what is not shown), a conversation not known yet, or a receipt
 * that is your own, from another device.
 */
export function seenByOther(conv: LinkedInConversation | undefined, by: string, at: number, meId: string): number | null {
  if (!conv || isGroup(conv, meId) || by === meId || !(at > 0)) return null;
  return conv.participants.some((p) => p.id === by) ? at : null;
}

function kindOf(mimeType: string): "image" | "pdf" | "video" | "audio" | "file" {
  const m = mimeType.toLowerCase();
  if (m.startsWith("image/")) return "image";
  if (m.startsWith("video/")) return "video";
  if (m.startsWith("audio/")) return "audio";
  return m === "application/pdf" ? "pdf" : "file";
}

export function attachmentRows(files: LinkedInFile[] = []) {
  return files.map((f) => ({
    filename: f.name?.trim() || "File",
    mime_type: f.mediaType || "application/octet-stream",
    kind: kindOf(f.mediaType || ""),
    size_bytes: f.size ?? null,
  }));
}

export function previewOf(text: string, m: LinkedInMessage, conv: LinkedInConversation, meId: string): string {
  const said = text.trim() || (m.files?.length ? `Attachment: ${m.files[0].name}` : "");
  const fromSomeoneInGroup = isGroup(conv, meId) && m.sender && m.sender.id !== meId;
  return oneLine(fromSomeoneInGroup ? `${personName(m.sender!)}: ${said}` : said);
}

/** The kind of name personName gives (contacts.display_name_rank): a member's or page's name, or the stand-in. */
export function personNameRank(p: LinkedInPerson): NameRank {
  return personName(p) === PLACEHOLDER_NAME ? STAND_IN : REAL_NAME;
}

async function personJson(p: LinkedInPerson, seal: Sealer) {
  return {
    urn: await seal.address(p.urn),
    urn_index: await seal.addressIndex(p.urn),
    display_name: await seal.text(FIELD.name, personName(p)),
    name_rank: personNameRank(p),
  };
}

/**
 * One message as public.ingest_linkedin takes it, or null when it is not stored. live is false for the
 * catch-up after connecting, which keeps archived conversations archived and old ones where they are.
 */
export async function ingestPayload(
  m: LinkedInMessage,
  conv: LinkedInConversation,
  meId: string,
  seal: Sealer,
  opts: { live: boolean; unread: boolean },
) {
  const said = messageText(m);
  if (!said) return null;
  const fromMe = m.sender?.id === meId;
  const sender = fromMe ? null : (m.sender ?? null);
  const unread = opts.unread && !fromMe;
  const group = isGroup(conv, meId);
  const chat = conv.urn || m.conversationUrn;
  const groupName = group ? conv.title?.trim() || null : null;
  const meta: Record<string, string | boolean | null> = { chat: await seal.address(chat), from_me: fromMe, type: (m.format ?? "DEFAULT").toLowerCase() };
  if (unread) meta.receipt = "pending"; // LinkedIn hears it was read only when you open it in the app
  if (said.deleted) meta.deleted = true;
  return {
    provider_message_id: m.urn,
    chat_id: await seal.address(chat),
    chat_index: await seal.chatIndex(chat),
    is_group: group,
    group_name: await seal.text(FIELD.name, groupName),
    group_name_index: groupName ? await seal.groupIndex(groupName) : null,
    status: conv.categories?.includes("ARCHIVE") && !opts.live ? "archived" : "inbox",
    resurface: opts.live && !fromMe,
    sent_at: new Date(m.deliveredAt || Date.now()).toISOString(),
    direction: fromMe ? "outbound" : "inbound",
    is_read: !unread,
    sender: sender ? await personJson(sender, seal) : null,
    sender_address: sender ? await seal.address(sender.urn) : null,
    sender_index: sender ? await seal.addressIndex(sender.urn) : null,
    participants: await Promise.all(others(conv, meId).map((p) => personJson(p, seal))),
    preview: await seal.text(FIELD.preview, previewOf(said.text, m, conv, meId)),
    body_text: await seal.text(FIELD.body, said.text || null),
    provider_meta: meta,
    // A file's name is sealed like the text; its hints (extension, receipt-like, sticker) are set when its file is saved.
    attachments: said.deleted ? [] : await Promise.all(attachmentRows(m.files).map(async (a) => ({ ...a, filename: (await seal.text(FIELD.filename, a.filename))! }))),
  };
}

export type IngestPayload = NonNullable<Awaited<ReturnType<typeof ingestPayload>>>;
