// Types for new emails, WhatsApp chats and queued replies, and the outbox attachment upload they share.


import type { Tables } from "@messages/db";
import type { Attachment, Draft } from "../types";
import { supabase } from "../supabase";
import { attachmentRows, type OutboxUpload } from "../outbox-files";

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
}

export function composeStatusOf(row: Pick<Tables<"outbox">, "status" | "thread_id" | "error">): ComposeStatus {
  return { status: row.status as ComposeStatus["status"], threadId: row.thread_id ?? undefined, error: row.error ?? undefined };
}

export interface PendingSend {
  id: string;
  threadId: string;
  body: string;
  createdAt: string;
  status: "queued" | "sending" | "sent" | "failed";
  error?: string;
  attachments?: Attachment[];
}

/**
 * Lists uploaded files on a queued outbox row, straight after it is inserted with attachment_count.
 * Tried twice; the worker fails the row if they never arrive. Each file has its own position, so a
 * retry after a lost answer is refused as a duplicate (23505), which means the first try worked. If
 * the worker has already taken the row, the files were all there, so that counts as attached too.
 */
export async function attachToOutbox(outboxId: string, files: OutboxUpload[]): Promise<boolean> {
  if (files.length === 0) return true;
  const rows = attachmentRows(outboxId, files);
  for (let attempt = 0; attempt < 2; attempt++) {
    const { error } = await supabase.from("outbox_attachments").insert(rows);
    if (!error) return true;
    if (attempt > 0 && error.code === "23505") return true;
  }
  const { data } = await supabase.from("outbox").select("status").eq("id", outboxId).maybeSingle();
  return data?.status === "sending" || data?.status === "sent";
}
