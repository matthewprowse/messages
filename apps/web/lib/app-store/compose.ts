// Types for new emails, WhatsApp chats and queued replies, and the outbox attachment upload they share.


import type { Tables } from "@messages/db";
import { FIELD } from "@messages/crypto/fields";
import type { Attachment, Draft } from "../types";
import { supabase } from "../supabase";
import { seal } from "../vault";
import { attachmentRows, type OutboxUpload } from "../outbox-files";
import { outboxFileNamePlace } from "../outbox-places";

export interface NewEmail {
  accountId: string;
  fromAddress: string;
  to: string[];
  /** Copied in the open and in secret. Stored sealed like To. */
  cc?: string[];
  bcc?: string[];
  subject: string;
  body: string;
  /** Files already uploaded to the outbox folder, in the order they were added. */
  files?: OutboxUpload[];
  /** The AI draft it started from, so learning can read what was changed. */
  draftId?: string;
  /** Send Later: an ISO time. Left out, the message waits only for the Undo Send window. */
  sendAt?: string;
}

/** A draft for New Email or New WhatsApp, which has no conversation yet: kept by the dialog that asked. */
export interface ComposeDraft {
  status: "pending" | "active" | "failed";
  body?: string;
  /** An email's subject line. */
  subject?: string;
  /** What you asked for, or said in a recording. */
  instruction?: string;
  error?: string;
}

export interface ComposeDraftRequest {
  accountId: string;
  channel: "email" | "whatsapp";
  /** Who it is to, when they are a contact, so the draft knows them and how you write to them. */
  contactId?: string;
  instruction?: string;
  audio?: Blob;
  /** "edit" with source: your own text, lightly corrected. */
  tone?: Draft["tone"];
  source?: string;
}

export interface ComposeStatus {
  status: "queued" | "sending" | "sent" | "failed";
  threadId?: string;
  error?: string;
  /** While the message waits for its Undo window or chosen time: when the worker may send it. */
  sendAfter?: string;
}

export function composeStatusOf(row: Pick<Tables<"outbox">, "status" | "thread_id" | "error"> & { send_after?: string | null }): ComposeStatus {
  return { status: row.status as ComposeStatus["status"], threadId: row.thread_id ?? undefined, error: row.error ?? undefined, sendAfter: row.send_after ?? undefined };
}

export interface PendingSend {
  id: string;
  threadId: string;
  body: string;
  createdAt: string;
  status: "queued" | "sending" | "sent" | "failed";
  error?: string;
  attachments?: Attachment[];
  /** What a retry needs to send the same thing again: the From address and, for Reply All, who it went to. */
  fromAddress?: string;
  copies?: { to: string[]; cc: string[] };
  /** Files the row was queued with. Placeholders reloaded from the outbox have the count but not the files. */
  fileCount?: number;
  /** When the worker may send it: the end of the Undo window, or the time chosen with Send Later. */
  sendAfter?: string;
  /** A WhatsApp send limit holding it back: it stays queued and goes by itself when the limit lifts. */
  waitReason?: "daily_limit" | "new_chat_limit";
}

/**
 * Lists uploaded files on a queued outbox row, straight after it is inserted with attachment_count.
 * Tried twice; the worker fails the row if they never arrive. Each file has its own position, so a
 * retry after a lost answer is refused as a duplicate (23505), which means the first try worked. If
 * the worker has already taken the row, the files were all there, so that counts as attached too. Each file's name is
 * sealed like the body; a key request that fails rejects, which the caller treats as not attached.
 */
export async function attachToOutbox(outboxId: string, files: OutboxUpload[]): Promise<boolean> {
  if (files.length === 0) return true;
  // Each name is sealed for this outbox row and its own file, so a name, a file and a row cannot be recombined.
  const named = await Promise.all(files.map(async (f) => ({ ...f, filename: await seal(FIELD.filename, f.filename, outboxFileNamePlace(outboxId, f.path)) })));
  const rows = attachmentRows(outboxId, named);
  for (let attempt = 0; attempt < 2; attempt++) {
    const { error } = await supabase.from("outbox_attachments").insert(rows);
    if (!error) return true;
    if (attempt > 0 && error.code === "23505") return true;
  }
  const { data } = await supabase.from("outbox").select("status").eq("id", outboxId).maybeSingle();
  return data?.status === "sending" || data?.status === "sent";
}
