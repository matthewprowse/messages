// Moving a chat's text between the agent's key (e1:) and the team's (t1:), which is all sharing a chat is. A value
// that is already where it should be is left alone, so a job that is run again, or resumed after a crash, does only
// the rest. The same list of columns is in public.message_needs_team_seal (20261101120000_shared_chats.sql), which
// finds the rows that still need moving: keep the two together.

import { decryptField, decryptTeamField, encryptField, encryptTeamField, isCiphertext, isTeamCiphertext, type TeamKeys, type UserKeys } from "@messages/crypto";
import { FIELD, type Field } from "@messages/crypto/fields";
import type { Json } from "@messages/db";

export type Direction = "to_work" | "to_personal";

/** The keys a job holds: the agent's, and the team's of the workspace it works for. */
export interface Keys {
  user(userId: string): Promise<UserKeys>;
  team(workspaceId: string): Promise<TeamKeys>;
}

/** Whose chat it is and which team it moves to or from. */
export interface Move {
  direction: Direction;
  userId: string;
  workspaceId: string;
}

// Each column with the kind of text it holds (fields.ts). Plain text is moved as well as sealed text. A group's name is
// shown to the team with the chat, so it moves with it (public.thread_needs_team_seal checks it too).
export const THREAD_TEXT = [["subject", FIELD.subject], ["group_name", FIELD.name], ["last_message_preview", FIELD.preview], ["summary", FIELD.summary]] as const;
/** Thread columns that name the chat and always move, whichever message is the latest. */
const NAMES_CHAT = new Set<string>(["subject", "group_name"]);
export const MESSAGE_TEXT = [
  ["subject", FIELD.subject], ["preview", FIELD.preview], ["body_text", FIELD.body], ["body_html", FIELD.html],
  ["list_unsubscribe", FIELD.unsubscribe], ["body_marks", FIELD.marks], ["transcript", FIELD.transcript],
] as const;
export const AI_TEXT = [["summary", FIELD.summary], ["reply_choices", FIELD.choices]] as const;

/**
 * One value moved to the other key. null and "" stay as they are. Going to work, anything not already t1 is sealed with
 * the team's key (an e1 value is opened with the agent's first); `onlySealed` leaves a readable value readable, for
 * addresses, which the database matches on while ENCRYPT_ADDRESSES is off. Going back, a t1 value is sealed with the
 * agent's key and everything else stays.
 */
export async function moveValue(keys: Keys, move: Move, field: Field, value: string | null, onlySealed = false): Promise<string | null> {
  if (value == null || value === "") return value;
  if (move.direction === "to_work") {
    if (isTeamCiphertext(value) || (onlySealed && !isCiphertext(value))) return value;
    const plain = isCiphertext(value) ? await decryptField(await keys.user(move.userId), field, value) : value;
    return encryptTeamField(await keys.team(move.workspaceId), field, plain);
  }
  if (!isTeamCiphertext(value)) return value;
  const plain = await decryptTeamField(await keys.team(move.workspaceId), field, value);
  return encryptField(await keys.user(move.userId), field, plain);
}

/** A row to write: the new values, and the old ones they replace, so the database writes only if nothing changed since. */
export interface RowWrite {
  id: string;
  expect: Record<string, Json>;
  set: Record<string, Json>;
}

export class Changes {
  readonly expect: Record<string, Json> = {};
  readonly set: Record<string, Json> = {};
  note(column: string, was: Json, now: Json) {
    if (was === now || JSON.stringify(was) === JSON.stringify(now)) return;
    this.expect[column] = was;
    this.set[column] = now;
  }
  write(id: string): RowWrite | null {
    return Object.keys(this.set).length ? { id, expect: this.expect, set: this.set } : null;
  }
}

/** The workspace a row is in when the chat is shared (the job's) or personal (none). */
const placed = (move: Move) => (move.direction === "to_work" ? move.workspaceId : null);

export interface MessageRow {
  id: string;
  workspace_id: string | null;
  subject: string | null;
  preview: string | null;
  body_text: string | null;
  body_html: string | null;
  list_unsubscribe: string | null;
  body_marks: string | null;
  transcript: string | null;
  sender_address: string | null;
  to_addresses: string[];
  provider_meta: Json;
}

/**
 * What to write for one message, or null when it is already where it should be. Its text, sender, recipients and the
 * text of a WhatsApp quote move; the chat and participant IDs in provider_meta stay under the agent's key, which the
 * worker needs to send. The blind indexes are not touched: an address is the same address under either key.
 */
export async function moveMessage(keys: Keys, move: Move, row: MessageRow): Promise<RowWrite | null> {
  const changes = new Changes();
  for (const [column, field] of MESSAGE_TEXT) changes.note(column, row[column], await moveValue(keys, move, field, row[column]));
  changes.note("sender_address", row.sender_address, await moveValue(keys, move, FIELD.address, row.sender_address, true));
  const to = await Promise.all((row.to_addresses ?? []).map(async (a) => (await moveValue(keys, move, FIELD.address, a, true)) ?? a));
  changes.note("to_addresses", row.to_addresses ?? [], to);

  const meta = row.provider_meta as { quoted?: { text?: unknown } } | null;
  if (meta && typeof meta === "object" && meta.quoted && typeof meta.quoted.text === "string") {
    const text = await moveValue(keys, move, FIELD.quote, meta.quoted.text);
    if (text !== meta.quoted.text) changes.note("provider_meta", row.provider_meta, { ...meta, quoted: { ...meta.quoted, text } } as Json);
  }
  changes.note("workspace_id", row.workspace_id, placed(move));
  return changes.write(row.id);
}

export interface MessageAiRow {
  message_id: string;
  workspace_id: string | null;
  summary: string;
  reply_choices: string | null;
}

/** What to write for one message's triage (its summary and reply choices), keyed by the message. */
export async function moveMessageAi(keys: Keys, move: Move, row: MessageAiRow): Promise<RowWrite | null> {
  const changes = new Changes();
  for (const [column, field] of AI_TEXT) changes.note(column, row[column], await moveValue(keys, move, field, row[column]));
  changes.note("workspace_id", row.workspace_id, placed(move));
  return changes.write(row.message_id);
}

/** A file's row only carries the workspace: the file itself is stored as the provider sent it. */
export function moveAttachment(move: Move, row: { id: string; workspace_id: string | null }): RowWrite | null {
  const changes = new Changes();
  changes.note("workspace_id", row.workspace_id, placed(move));
  return changes.write(row.id);
}

export interface ThreadRow {
  id: string;
  user_id: string;
  workspace_id: string | null;
  share_from: string | null;
  last_message_at: string | null;
  subject: string | null;
  last_message_preview: string | null;
  summary: string | null;
  share_label: string | null;
  is_group: boolean;
  group_name: string | null;
  /** account for a chat in a shared inbox. Not every reader asks for it. */
  shared_by?: string | null;
}

/** Whether the chat's latest message is one that is shared, so its preview and summary may be too. */
export function latestIsShared(thread: Pick<ThreadRow, "share_from" | "last_message_at">): boolean {
  if (thread.share_from == null) return true;
  return thread.last_message_at != null && Date.parse(thread.last_message_at) >= Date.parse(thread.share_from);
}

/** Who a chat is with, in the words the owner's list shows. */
export interface LabelSource {
  groupName: string | null;
  /** Names of the people in it, readable, the agent's own contacts. */
  contactNames: string[];
  subject: string | null;
}

/** The client or group name for a shared chat: the group's name, else the first person's, else the subject. */
export function shareLabel(source: LabelSource): string {
  const name = (s: string | null | undefined) => (s ?? "").trim();
  return name(source.groupName) || source.contactNames.map(name).find(Boolean) || name(source.subject) || "Unnamed Chat";
}

/**
 * What to write for the chat's own row. Its subject and group name name the chat and always move; its preview and summary move
 * only once its latest message is shared (a chat shared from today keeps an older preview under the agent's key until a
 * shared message replaces it). The label is made when going to work and cleared when going back. null when nothing changes.
 */
export async function moveThread(keys: Keys, move: Move, row: ThreadRow, label: () => Promise<string>): Promise<RowWrite | null> {
  const changes = new Changes();
  const latest = move.direction === "to_personal" || latestIsShared(row);
  for (const [column, field] of THREAD_TEXT) {
    if (!NAMES_CHAT.has(column) && !latest) continue;
    changes.note(column, row[column], await moveValue(keys, move, field, row[column]));
  }
  if (move.direction === "to_work") {
    if (row.share_label == null) changes.note("share_label", null, await encryptTeamField(await keys.team(move.workspaceId), FIELD.name, await label()));
  } else {
    changes.note("share_label", row.share_label, null);
  }
  return changes.write(row.id);
}
