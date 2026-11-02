// Loading the parts of a client timeline that the app store does not already hold: a page of the contact's messages, their
// promises and their lead captures. Reads only, so nothing is marked read and no WhatsApp read receipt goes out. Sealed text is
// opened here; row level security scopes every query to the signed-in user.

import { FIELD } from "@messages/crypto/fields";
import type { Commitment } from "../commitments";
import { mapCommitment } from "../commitments-io";
import { supabase } from "../supabase";
import { openRows } from "../vault";
import { leadItem, messageItem, promiseItem } from "./items";
import type { TimelineItem } from "./types";

/** Messages fetched a page at a time, newest first, so a client with years of history opens at once. */
export const MESSAGE_PAGE = 40;
const IN_CHUNK = 100; // conversation ids per request: they go in the address, so they are asked in chunks
const PROMISE_LIMIT = 200;
const LEAD_LIMIT = 100;

const chunks = <T>(list: T[], size: number): T[][] => Array.from({ length: Math.ceil(list.length / size) }, (_, i) => list.slice(i * size, (i + 1) * size));

export interface MessagePage { items: TimelineItem[]; /** Pass back as `before` for the next page. Null when there are no more. */ next: string | null }

/**
 * One page of messages in these conversations older than `before` (none given: the newest), newest first. Newsletters and
 * marketing mail are left out: a client's timeline is what was said to or by them. Rejects when the read fails.
 */
export async function loadMessagePage(channels: Map<string, string>, before: string | null, size = MESSAGE_PAGE): Promise<MessagePage> {
  const ids = [...channels.keys()];
  if (ids.length === 0) return { items: [], next: null };
  const rows = (await Promise.all(chunks(ids, IN_CHUNK).map(async (part) => {
    let q = supabase.from("messages").select("id, thread_id, sent_at, direction, preview, subject, transcript_status").in("thread_id", part).eq("is_bulk", false);
    if (before) q = q.lt("sent_at", before);
    const { data, error } = await q.order("sent_at", { ascending: false }).limit(size);
    if (error) throw new Error(`Load timeline failed (${error.code})`);
    return data;
  }))).flat().sort((a, b) => b.sent_at.localeCompare(a.sent_at)).slice(0, size);
  await openRows(rows, [["preview", FIELD.preview], ["subject", FIELD.subject]] as const);
  const items = rows.map((r) => messageItem({
    id: r.id, threadId: r.thread_id, sentAt: r.sent_at, outgoing: r.direction === "outbound", preview: r.preview ?? "", subject: r.subject ?? "",
    voice: !!r.transcript_status, channel: channels.get(r.thread_id) ?? "email",
  }));
  return { items, next: rows.length === size ? rows[rows.length - 1].sent_at : null };
}

/** Promises (open and done) found in these conversations, as timeline items. */
export async function loadPromiseItems(threadIds: string[], now: Date): Promise<TimelineItem[]> {
  if (threadIds.length === 0) return [];
  const rows = (await Promise.all(chunks(threadIds, IN_CHUNK).map(async (part) => {
    const { data, error } = await supabase.from("commitments").select("id, thread_id, message_id, owner, text, due_on, status, snoozed_until, created_at").in("thread_id", part).order("created_at", { ascending: false }).limit(PROMISE_LIMIT);
    if (error) throw new Error(`Load promises failed (${error.code})`);
    return data;
  }))).flat();
  await openRows(rows, [["text", FIELD.taskTitle]] as const);
  return rows.map((r) => promiseItem({ ...mapCommitment(r) as Commitment, createdAt: r.created_at }, now));
}

/** The leads automations captured from this contact's enquiries, as timeline items. */
export async function loadLeadItems(contactId: string): Promise<TimelineItem[]> {
  const { data, error } = await supabase
    .from("automation_runs")
    .select("id, thread_id, status, created_at, automations(template_key)")
    .eq("contact_id", contactId)
    .in("status", ["done", "undone"])
    .order("created_at", { ascending: false })
    .limit(LEAD_LIMIT);
  if (error) throw new Error(`Load leads failed (${error.code})`);
  return data.map((r) => leadItem({ id: r.id, createdAt: r.created_at, threadId: r.thread_id, templateKey: r.automations?.template_key ?? null, undone: r.status === "undone" }));
}
