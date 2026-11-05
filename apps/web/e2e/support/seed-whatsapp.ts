// Writes the made-up WhatsApp chats into Konva Test the way the sync worker's connector stores them: each message through
// public.ingest_whatsapp with the payload apps/worker/src/whatsapp/message-payload.ts builds (sealed number, chat id and
// names, blind indexes, a group's name sealed with its index). Also builds one message's payload for the fake worker
// (fake-incoming.ts), which stores later arrivals the same way. No WhatsApp session exists, so nothing can be sent.

import { randomUUID } from "node:crypto";
import { addressIndex, chatIndex, groupNameIndex } from "@messages/crypto/addresses";
import type { Json } from "@messages/db";
import type { Admin } from "./admin";
import { WA_PEOPLE, type FakeChat, type FakeContact } from "./fake-chats";
import { FIELD, keysFor, seal } from "./seal";

/** A person as public.whatsapp_contact takes them: number and names sealed, the number's index, and the rank of the name. */
async function personJson(userId: string, p: FakeContact) {
  const keys = await keysFor(userId);
  return {
    phone: await seal(userId, FIELD.address, p.phone),
    lid: null,
    phone_index: await addressIndex(keys, p.phone),
    lid_index: null,
    display_name: await seal(userId, FIELD.name, p.name),
    name_rank: 2,
    push_name: await seal(userId, FIELD.name, p.name),
  };
}

/** What one message needs to be stored. */
export interface WhatsAppMail {
  id: string;
  jid: string;
  group?: { name: string };
  /** The sender, for a message that is not the user's own. */
  sender?: FakeContact;
  /** The other person of a one to one chat. */
  other?: FakeContact;
  body: string;
  sentAt: Date;
  fromMe: boolean;
  unread: boolean;
}

/** One message's ingest_whatsapp payload, field for field as message-payload.ts buildPayload makes it for a plain text message. */
export async function whatsappPayload(userId: string, m: WhatsAppMail): Promise<Json> {
  const keys = await keysFor(userId);
  const group = !!m.group;
  const name = m.group?.name.trim() ?? null;
  const preview = group && m.sender ? `${m.sender.name}: ${m.body}` : m.body;
  const senderAddress = m.sender?.phone ?? null;
  return {
    provider_message_id: m.id,
    chat_jid: await seal(userId, FIELD.address, m.jid),
    chat_alt_jid: null,
    chat_index: await chatIndex(keys, m.jid),
    chat_alt_index: null,
    is_group: group,
    group_name: name ? await seal(userId, FIELD.name, name) : null,
    group_name_index: name ? await groupNameIndex(keys, name) : null,
    status: "inbox",
    resurface: !m.fromMe,
    sent_at: m.sentAt.toISOString(),
    direction: m.fromMe ? "outbound" : "inbound",
    is_read: !m.unread,
    sender: m.sender && !m.fromMe ? await personJson(userId, m.sender) : null,
    sender_address: senderAddress ? await seal(userId, FIELD.address, senderAddress) : null,
    sender_index: senderAddress ? await addressIndex(keys, senderAddress) : null,
    participants: !group && m.other ? [await personJson(userId, m.other)] : [],
    preview: await seal(userId, FIELD.preview, preview.replace(/\s+/g, " ").trim()),
    body_text: await seal(userId, FIELD.body, m.body),
    provider_meta: { chat: await seal(userId, FIELD.address, m.jid), from_me: m.fromMe, participant: null, type: "text", ...(m.unread ? { receipt: "pending" } : {}) },
    attachments: [],
  };
}

/** Stores one WhatsApp message and returns its message and conversation ids. */
export async function ingestWhatsApp(db: Admin, accountId: string, payload: Json): Promise<{ messageId: string; threadId: string }> {
  const { data, error } = await db.rpc("ingest_whatsapp", { p_account_id: accountId, p_msg: payload });
  if (error) throw Object.assign(new Error("ingest_whatsapp failed."), { code: error.code });
  const done = data as { message_id?: string; thread_id?: string } | null;
  if (!done?.message_id || !done.thread_id) throw new Error("ingest_whatsapp stored nothing.");
  return { messageId: done.message_id, threadId: done.thread_id };
}

/** What the seed made of a chat. */
export interface SeededChat {
  key: string;
  threadId: string;
}

/** Ingests every chat's messages in order through public.ingest_whatsapp_batch, a call for all of them (the worker batches history the same way). */
export async function ingestChats(db: Admin, userId: string, accountId: string, list: FakeChat[], now: number): Promise<SeededChat[]> {
  const flat: { key: string; payload: Json }[] = [];
  for (const c of list) {
    for (const m of c.messages) {
      const fromMe = m.from === "me";
      flat.push({ key: c.key, payload: await whatsappPayload(userId, {
        id: randomUUID().replace(/-/g, "").toUpperCase(), jid: c.jid, group: c.group, sender: fromMe ? undefined : WA_PEOPLE[m.from as number],
        other: c.with === undefined ? undefined : WA_PEOPLE[c.with], body: m.body, sentAt: new Date(now - m.minutesAgo * 60_000), fromMe, unread: !!m.unread,
      }) });
    }
  }
  const { data, error } = await (db.rpc.bind(db) as unknown as (fn: string, args: object) => PromiseLike<{ data: unknown; error: { code?: string } | null }>)("ingest_whatsapp_batch", { p_account_id: accountId, p_msgs: flat.map((f) => f.payload) });
  if (error || !Array.isArray(data) || data.length !== flat.length) throw Object.assign(new Error("ingest_whatsapp_batch failed."), { code: error?.code ?? "bad_result" });
  const threads = new Map<string, string>();
  data.forEach((r: { thread_id?: string; result?: string }, i) => {
    if (!r.thread_id) throw new Error(`ingest_whatsapp_batch stored nothing for message ${i} (${r.result}).`);
    threads.set(flat[i].key, r.thread_id);
  });
  return list.map((c) => ({ key: c.key, threadId: threads.get(c.key)! }));
}
