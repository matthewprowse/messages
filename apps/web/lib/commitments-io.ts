// Loading promises (public.commitments) and ticking or snoozing one. The text is sealed with the user's key (field
// task_title) and opened here. Rows are scoped to the user by row level security; the AI worker is the only writer of new ones.

import { FIELD } from "@messages/crypto/fields";
import { supabase } from "./supabase";
import { openRows } from "./vault";
import type { Commitment } from "./commitments";

const COLUMNS = "id, thread_id, message_id, owner, text, due_on, status, snoozed_until";
const LIMIT = 500;

interface Row { id: string; thread_id: string; message_id: string; owner: string; text: string; due_on: string | null; status: string; snoozed_until: string | null }

/** A database row as the app's type. */
export function mapCommitment(row: Row): Commitment {
  return { id: row.id, threadId: row.thread_id, messageId: row.message_id, owner: row.owner === "them" ? "them" : "me", text: row.text.trim(), dueOn: row.due_on, status: row.status === "done" ? "done" : "open", snoozedUntil: row.snoozed_until };
}

/** Every open promise, soonest due first. Rejects when the table cannot be read (the caller keeps what it had). */
export async function loadCommitments(): Promise<Commitment[]> {
  const { data, error } = await supabase.from("commitments").select(COLUMNS).eq("status", "open").order("due_on", { ascending: true, nullsFirst: false }).limit(LIMIT);
  if (error) throw new Error(`Load promises failed (${error.code})`);
  const rows = data as Row[];
  await openRows(rows, [["text", FIELD.taskTitle]] as const);
  return rows.map(mapCommitment);
}

/** Marks a promise done. Rejects on failure so the caller can put it back. */
export async function saveDone(id: string): Promise<void> {
  const { error } = await supabase.from("commitments").update({ status: "done", done_at: new Date().toISOString() }).eq("id", id);
  if (error) throw new Error(`Save promise failed (${error.code})`);
}

/** Hides a promise until a time. Rejects on failure so the caller can put it back. */
export async function saveSnooze(id: string, until: string): Promise<void> {
  const { error } = await supabase.from("commitments").update({ snoozed_until: until }).eq("id", id);
  if (error) throw new Error(`Save promise failed (${error.code})`);
}
