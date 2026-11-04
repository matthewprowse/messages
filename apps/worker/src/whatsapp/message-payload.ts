// Builds the payload public.ingest_whatsapp takes for one message: everything sealed or indexed for the user, plus
// the provider_meta kept with it. The connector (connectors/whatsapp.ts) works out who and what first; this only
// shapes and encrypts, so no link or queue state is read here.

import type { WAMessage, WAMessageKey } from "baileys";
import { FIELD } from "@messages/crypto/fields";
import { addressIndex, chatIndex } from "@messages/crypto/addresses";
import type { Json } from "@messages/db";
import { groupNameJson, keysFor, seal, sealAddress } from "../vault";
import { mediaRef } from "./media";
import { mediaContent } from "./media-content";
import type { describe } from "./normalize";
import { oneLine } from "./normalize";
import { personJson, type AccountCtx, type Person, type StoredMeta } from "./person";
import { historyReactions } from "./reactions";

type Described = Extract<ReturnType<typeof describe>, { kind: "message" }>;

/** A quoted reply, as provider_meta.quoted keeps it (the app shows a quote block). */
export interface Quoted {
  id: string;
  author: string;
  from_me: boolean;
  text: string;
}

/** The chat JID's stored name and archive flag, when the chat list told us. */
export interface KnownChat {
  name?: string | null;
  archived?: boolean | null;
}

export interface PayloadInput {
  msg: WAMessage;
  key: WAMessageKey;
  remote: string;
  id: string;
  d: Described;
  group: boolean;
  fromMe: boolean;
  sentAt: Date;
  chatJid: string;
  chatAlt: string | null;
  sender: Person | null;
  participants: Person[];
  quoted: Quoted | null;
  body: string;
  live: boolean;
  unread: boolean;
  /** Read after the meta is sealed, so the chat list and group cache are looked at as late as they always were. */
  known: () => { chat: KnownChat | undefined; groupSubject: string | undefined };
}

/** The payload and the provider_meta it carries (the connector reads meta.media when it queues the file download). */
export async function buildPayload(ctx: AccountCtx, p: PayloadInput) {
  const { msg, key, remote, d, group, fromMe, sender } = p;
  const preview = group && sender ? `${sender.display_name}: ${d.preview}` : d.preview;

  const content = msg.message ? mediaContent(msg.message, d.media?.type) : null;
  const meta: StoredMeta & Record<string, unknown> = {
    chat: await sealAddress(ctx.userId, remote),
    from_me: fromMe,
    participant: await sealAddress(ctx.userId, key.participant ?? null),
    type: d.type,
    ...(d.media && content ? { media: mediaRef(d.media.type, content) } : {}),
    ...(p.unread ? { receipt: "pending" } : {}),
    ...(p.quoted ? { quoted: p.quoted } : {}),
    ...(d.call ? { call: d.call } : {}),
    // The vote key is sealed: whoever holds it can read the votes (polls.ts). Sealed as a quote, which is also free text.
    ...(d.poll ? { poll: { multi: d.poll.multi, ...(d.poll.secret ? { secret: await seal(ctx.userId, FIELD.quote, Buffer.from(d.poll.secret).toString("base64")) } : {}) } } : {}),
    ...(msg.reactions?.length ? await historyReactions(ctx.userId, msg.reactions) : {}),
  };

  const { chat, groupSubject } = p.known();
  const keys = await keysFor(ctx.userId);
  const senderAddress = sender ? (sender.phone ?? sender.lid) : null;
  const payload = {
    provider_message_id: p.id,
    chat_jid: await sealAddress(ctx.userId, p.chatJid, { place: "threads.provider_thread_id" }),
    chat_alt_jid: await sealAddress(ctx.userId, p.chatAlt),
    chat_index: await chatIndex(keys, p.chatJid),
    chat_alt_index: p.chatAlt ? await chatIndex(keys, p.chatAlt) : null,
    is_group: group,
    // Sealed, with the index ingest_whatsapp tells a renamed group by.
    ...(await groupNameJson(ctx.userId, group ? (groupSubject ?? chat?.name ?? null) : null)),
    status: chat?.archived && !p.live ? "archived" : "inbox",
    resurface: p.live && !fromMe,
    sent_at: p.sentAt.toISOString(),
    direction: fromMe ? "outbound" : "inbound",
    is_read: !p.unread,
    sender: sender ? await personJson(keys, sender, ctx.userId) : null,
    sender_address: await sealAddress(ctx.userId, senderAddress, { place: "messages.sender_address" }),
    sender_index: senderAddress ? await addressIndex(keys, senderAddress) : null,
    participants: await Promise.all(p.participants.map((x) => personJson(keys, x, ctx.userId))),
    preview: await seal(ctx.userId, FIELD.preview, oneLine(preview), { place: "messages.preview" }),
    body_text: await seal(ctx.userId, FIELD.body, p.body || null, { place: "messages.body_text" }),
    provider_meta: meta as Json,
    attachments: d.media
      ? [{ filename: (await seal(ctx.userId, FIELD.filename, d.media.filename, { place: "attachments.filename" }))!, mime_type: d.media.mimeType, kind: d.media.kind, size_bytes: d.media.sizeBytes }]
      : [],
  } satisfies Record<string, Json>;
  return { payload, meta };
}
