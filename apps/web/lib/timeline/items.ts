// Maps each source of the client timeline (messages, meetings, notes, promises, tasks, documents, lead captures) to a
// TimelineItem. Pure: callers pass rows already opened. The words are plain British English with Title Case labels.

import type { Commitment } from "../commitments";
import { dueText } from "../commitments";
import type { Meeting } from "../meeting-text";
import type { DocCard } from "../search/document-card";
import { DOC_LABEL } from "../search/document-card";
import type { Task } from "../types";
import { refKey, type TimelineItem } from "./types";

const PREVIEW_MAX = 160; // characters of a message shown on its row

/** A message row as the timeline loads it: only what a row needs, never the whole body. */
export interface MessageRow { id: string; threadId: string; sentAt: string; outgoing: boolean; preview: string; subject: string; voice: boolean; channel: string }

const CHANNEL_NAME: Record<string, string> = { whatsapp: "WhatsApp", linkedin: "LinkedIn", instagram: "Instagram" };

/** Text with whitespace squeezed and cut to `max` characters. */
export function squeeze(text: string, max = PREVIEW_MAX): string {
  const t = text.replace(/\s+/g, " ").trim();
  return t.length > max ? `${t.slice(0, max - 1).trimEnd()}...` : t;
}

/** A message: titled by its email subject or "Voice Note"/"WhatsApp Message", with its first words under it. */
export function messageItem(m: MessageRow): TimelineItem {
  const label = m.channel === "email" ? m.subject.trim() || "No Subject" : m.voice ? "Voice Note" : `${CHANNEL_NAME[m.channel] ?? "Chat"} Message`;
  return {
    key: `message:${m.id}`, type: "message", at: m.sentAt,
    title: m.outgoing ? `You: ${label}` : label,
    detail: squeeze(m.preview) || undefined,
    href: `/inbox/${m.threadId}`, channel: m.channel, outgoing: m.outgoing,
    refs: [refKey("thread", m.threadId)],
  };
}

/** A meeting at its start, with its summary (or the action items) under it. */
export function meetingItem(m: Meeting): TimelineItem {
  return {
    key: `meeting:${m.id}`, type: "meeting", at: m.startedAt,
    title: m.title || "Meeting",
    detail: m.summary ? squeeze(m.summary, 240) : m.actionItems.length ? squeeze(m.actionItems.join(". "), 240) : undefined,
    href: m.calendarEventId ? "/calendar" : undefined,
    refs: [refKey("meeting", m.id)],
  };
}

/** A note linked to the contact, at its last edit. */
export function noteItem(n: { id: string; title: string; updatedAt: string }): TimelineItem {
  return { key: `note:${n.id}`, type: "note", at: n.updatedAt, title: n.title.trim() || "Untitled Note", href: `/notes/${n.id}`, refs: [refKey("note", n.id)] };
}

/** A promise found in a conversation, at the time it was found. */
export function promiseItem(c: Commitment & { createdAt: string }, now: Date): TimelineItem {
  return {
    key: `promise:${c.id}`, type: "promise", at: c.createdAt,
    title: `${c.owner === "me" ? "You Promised" : "They Promised"}: ${c.text}`,
    detail: c.status === "done" ? "Done" : dueText(c, now),
    href: `/inbox/${c.threadId}`, refs: [refKey("thread", c.threadId)],
  };
}

/** A task about the contact, at its due time, else when it was done. A task with neither has no place in time and is left out. */
export function taskItem(t: Task): TimelineItem | null {
  const at = t.dueAt ?? t.completedAt;
  if (!at) return null;
  return { key: `task:${t.id}`, type: "task", at, title: t.title, detail: t.completed ? "Done" : "Open", href: "/calendar", refs: [] };
}

/** A file with a document card, at the time of the message it came in. */
export function documentItem(f: { id: string; name: string; sentAt: string; threadId: string }, card: DocCard): TimelineItem {
  const bits = [card.counterparty, card.amount != null ? `${card.currency} ${card.amount.toLocaleString("en-ZA")}` : "", card.due ? `Due ${card.due}` : "", card.reference].filter(Boolean);
  return {
    key: `document:${f.id}`, type: "document", at: f.sentAt,
    title: `${DOC_LABEL[card.type]}: ${f.name}`,
    detail: [bits.join(", "), card.summary].filter(Boolean).join(". "),
    href: `/inbox/${f.threadId}`, refs: [refKey("attachment", f.id), refKey("thread", f.threadId)],
  };
}

/** The names a lead template is shown under. */
const SOURCE: Record<string, string> = { property24: "Property24", private_property: "Private Property" };

/** A lead an automation captured from an enquiry email. */
export function leadItem(r: { id: string; createdAt: string; threadId: string | null; templateKey: string | null; undone: boolean }): TimelineItem {
  const from = r.templateKey ? SOURCE[r.templateKey] : undefined;
  return {
    key: `lead:${r.id}`, type: "lead", at: r.createdAt,
    title: from ? `Lead Captured From ${from}` : "Lead Captured",
    detail: r.undone ? "Undone" : undefined,
    href: r.threadId ? `/inbox/${r.threadId}` : undefined,
    refs: r.threadId ? [refKey("thread", r.threadId)] : [],
  };
}
