// Loads a conversation's messages: the newest page, older pages, a jump back to a time, a catch-up after a known
// message, and a single message's files. Keyset paging on (sent_at, id) throughout.

import { openAddresses, openMessages } from "../open-rows";
import { supabase } from "../supabase";
import type { Message } from "../types";
import { withSealedColumns } from "../sealed-columns";
import { ATTACHMENT_COLUMNS, MESSAGE_COLUMNS, type AttachmentRow } from "./columns";
import { mapMessage } from "./map-message";

/** How many messages a conversation opens with, and how many more each scroll up loads. */
export const MESSAGE_PAGE = 200;

export interface MessagePage {
  messages: Message[];
  /** Whether older messages may be left to load. */
  more: boolean;
}

/**
 * A conversation's messages, oldest first. By default the newest page; with before, the page older than
 * that message; with from, every message from that time on, for jumping to an older message.
 */
export async function loadThreadMessages(threadId: string, at: { before?: Pick<Message, "id" | "sentAt">; from?: string; limit?: number } = {}): Promise<MessagePage> {
  if (at.from) {
    // Pages back from the newest until the target time, so the result always reaches the target with no gap.
    const out: Message[] = [];
    let before = at.before;
    for (;;) {
      const page = await messagePage(threadId, before, at.from, 1000);
      out.push(...page);
      if (page.length < 1000) break;
      before = page[page.length - 1];
    }
    return { messages: out.reverse(), more: true };
  }
  const size = at.limit ?? MESSAGE_PAGE;
  const page = await messagePage(threadId, at.before, undefined, size);
  return { messages: page.reverse(), more: page.length === size };
}

/**
 * The messages sent after one, oldest first, for catching up on a conversation that is already open.
 * Null when a whole page came back, as there may be more: the caller then reloads the conversation.
 */
export async function loadMessagesAfter(threadId: string, after: Pick<Message, "id" | "sentAt">): Promise<Message[] | null> {
  const { data, error } = await supabase.from("messages").select(await withSealedColumns(MESSAGE_COLUMNS)).eq("thread_id", threadId)
    .or(`sent_at.gt."${after.sentAt}",and(sent_at.eq."${after.sentAt}",id.gt.${after.id})`)
    .order("sent_at").order("id").limit(MESSAGE_PAGE);
  if (error) throw error;
  if (data.length >= MESSAGE_PAGE) return null;
  return (await openMessages(data)).map(mapMessage);
}

/** Up to limit messages older than before (if given) and no older than from (if given), newest first. */
async function messagePage(threadId: string, before: Pick<Message, "id" | "sentAt"> | undefined, from: string | undefined, limit: number): Promise<Message[]> {
  let query = supabase.from("messages").select(await withSealedColumns(MESSAGE_COLUMNS)).eq("thread_id", threadId);
  // Keyset paging on (sent_at, id), so messages sent in the same second are neither missed nor repeated.
  if (before) query = query.or(`sent_at.lt."${before.sentAt}",and(sent_at.eq."${before.sentAt}",id.lt.${before.id})`);
  if (from) query = query.gte("sent_at", from);
  const { data, error } = await query.order("sent_at", { ascending: false }).order("id", { ascending: false }).limit(limit);
  if (error) throw error;
  return (await openMessages(data)).map(mapMessage);
}

/** When a message was sent, if it is in this conversation. */
export async function messageSentAt(threadId: string, messageId: string): Promise<string | null> {
  const { data } = await supabase.from("messages").select("sent_at").eq("thread_id", threadId).eq("id", messageId).maybeSingle();
  return data?.sent_at ?? null;
}

export async function loadMessage(messageId: string): Promise<Message | null> {
  const { data, error } = await supabase.from("messages").select(await withSealedColumns(MESSAGE_COLUMNS)).eq("id", messageId).maybeSingle();
  if (error) throw error;
  return data ? mapMessage((await openMessages([data]))[0]) : null;
}

/** A message's files, for a message that arrived over Realtime, whose payload carries none. */
export async function loadMessageAttachments(messageId: string): Promise<AttachmentRow[]> {
  const { data, error } = await supabase.from("attachments").select(await withSealedColumns(ATTACHMENT_COLUMNS)).eq("message_id", messageId).order("id");
  if (error) throw error;
  return openAddresses(data);
}
