// Maps message and attachment rows to the app's Message and Attachment, and applies a Realtime UPDATE to a held
// message. Pure: no network, no database.

import type { Attachment, Message } from "../types";
import { formatSize } from "../format";
import { emailParts, emphasisRuns, type Emphasis } from "../email-text";
import type { AttachmentRow, MessageRow } from "./columns";

/** What a WhatsApp message carries in provider_meta besides where it lives: its quote, reactions and state. */
export function whatsappExtras(meta: unknown): Pick<Message, "quote" | "reactions" | "deleted" | "edited" | "receipt"> {
  const m = (meta ?? {}) as {
    quoted?: { id?: string; author?: string; from_me?: boolean; text?: string };
    reactions?: Record<string, string>;
    deleted?: boolean;
    edited?: boolean;
    receipt?: string;
  };
  const q = m.quoted;
  return {
    quote: q?.id && q.text ? { id: q.id, author: q.author || "Unknown", fromMe: !!q.from_me, text: q.text } : undefined,
    reactions: m.reactions && Object.keys(m.reactions).length ? m.reactions : undefined,
    deleted: m.deleted || undefined,
    edited: m.edited || undefined,
    receipt: m.receipt === "sent" || m.receipt === "delivered" || m.receipt === "read" ? m.receipt : undefined,
  };
}

export function mapAttachment(a: Omit<AttachmentRow, "message_id" | "hidden">): Attachment {
  return {
    id: a.id, name: a.filename, kind: a.kind as Attachment["kind"], size: formatSize(a.size_bytes), bytes: a.size_bytes ?? undefined, path: a.team_path ?? a.storage_path ?? undefined,
    // A team copy has no thumbnail, and an empty thumb_path means a thumbnail was tried and cannot be made.
    thumbPath: !a.team_path && a.thumb_path ? a.thumb_path : undefined,
    sealed: a.sealed || undefined, notKept: (a.not_kept as Attachment["notKept"]) ?? undefined,
  };
}

/** Only WhatsApp rows say which chat they are in. */
const isWhatsapp = (meta: unknown) => typeof (meta as { chat?: unknown } | null)?.chat === "string";

/**
 * The bold and italic runs of an email: stored on arrival as JSON in body_marks, or worked out from
 * HTML still stored from before that.
 */
export function emailMarks(row: Pick<MessageRow, "body_html" | "body_marks">): Emphasis[] | undefined {
  if (row.body_marks) {
    try {
      const runs = JSON.parse(row.body_marks) as Emphasis[];
      if (Array.isArray(runs) && runs.length) return runs;
    } catch {
      // Unreadable marks only cost the formatting.
    }
  }
  const runs = row.body_html ? emphasisRuns(row.body_html) : [];
  return runs.length ? runs : undefined;
}

export function mapMessage(row: MessageRow): Message {
  const whatsapp = isWhatsapp(row.provider_meta);
  // WhatsApp text is kept as sent, formatting markers and all: the bubble draws them (rich-text.ts).
  // The HTML is not stored (View Original fetches it): whether the email is bulk was worked out on arrival.
  const parts = whatsapp ? { body: row.body_text ?? "" } : emailParts(row.body_text, row.body_html ?? null, row.subject, row.is_bulk);
  // Logos, signature images and tracking pixels are hidden.
  const files = row.attachments.filter((a) => !a.hidden).map(mapAttachment);
  return {
    ...whatsappExtras(row.provider_meta),
    id: row.id,
    providerId: row.provider_message_id,
    threadId: row.thread_id,
    from: row.direction === "outbound" ? "me" : row.sender_contact_id ?? "unknown",
    address: row.sender_address ?? undefined,
    toAddresses: row.to_addresses?.length ? row.to_addresses : undefined,
    sentAt: row.sent_at,
    body: parts.body,
    quoted: parts.quoted,
    bulk: parts.bulk,
    forward: parts.forward,
    marks: whatsapp ? undefined : emailMarks(row),
    transcript: row.transcript ?? undefined,
    whatsapp: whatsapp || undefined,
    hasOriginal: row.has_original,
    // body_shrunk_at is read through a cast: the generated types do not know it until they are regenerated.
    bodyShrunk: (row as { body_shrunk_at?: string | null }).body_shrunk_at ? true : undefined,
    attachments: files.length ? files : undefined,
  };
}

/**
 * A stored message after a Realtime UPDATE: its reactions, quote, edit or deletion, and a chat message's
 * new text. Email bodies never change and may be missing from the payload, so they are left alone.
 * Returns the same object when nothing shown has changed, such as when only is_read did.
 */
export function patchMessage(m: Message, row: { provider_meta?: unknown; body_text?: string | null; transcript?: string | null }): Message {
  const next: Message = row.provider_meta === undefined ? { ...m } : { ...m, ...whatsappExtras(row.provider_meta) };
  if (typeof row.transcript === "string") next.transcript = row.transcript; // a voice note's, written after it arrived
  if (m.whatsapp && typeof row.body_text === "string") next.body = row.body_text;
  else if (!m.hasOriginal && typeof row.body_text === "string") {
    const parts = emailParts(row.body_text, null);
    next.body = parts.body;
    next.quoted = parts.quoted;
  }
  const shown = (x: Message) => JSON.stringify([x.body, x.quoted, x.quote, x.reactions, x.deleted, x.edited, x.transcript]);
  return shown(next) === shown(m) ? m : next;
}
