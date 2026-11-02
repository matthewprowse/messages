// Turns the app's own objects and decrypted rows into search documents. Pure: no network, no storage. Text is tidied and
// cut to the per kind length here (types.ts TEXT_CAP), which is what keeps the index small enough to hold in memory.

import { isCiphertext } from "@messages/crypto";
import { emailParts } from "@messages/email-text";
import { noteExcerpt } from "../note-text";
import { searchDigits } from "../phone-search";
import type { Contact, Task, Thread } from "../types";
import { docId } from "./engine";
import { TEXT_CAP, type Doc, type Kind } from "./types";

/** Who people are, by contact id: names only, looked up from the store. */
export interface People {
  nameOf: (contactId: string) => string | undefined;
  /** Everyone else in a conversation, for the To side of a message you sent. Empty when unknown. */
  peersOf: (threadId: string) => string;
}

/** Whitespace collapsed and the text cut to the kind's length. */
export function clip(text: string | null | undefined, kind: Kind): string {
  const cap = TEXT_CAP[kind];
  if (!text || cap === 0) return "";
  return text.replace(/\s+/g, " ").trim().slice(0, cap);
}

const ms = (iso: string | null | undefined) => {
  const t = iso ? Date.parse(iso) : NaN;
  return Number.isNaN(t) ? 0 : t;
};

// A plain boolean, not the type guard: a value left sealed (a key that would not open it) is skipped, whatever its type says.
const sealed = (value: unknown): boolean => isCiphertext(value);

const join = (...parts: (string | null | undefined)[]) => parts.filter(Boolean).join(" ");

/** A conversation: titled like its row in the Inbox, searchable by its subject, preview, summary and who is in it. */
export function threadDoc(t: Thread, contactOf: (id: string) => Contact | undefined): Doc {
  const people = t.participantIds.map(contactOf).filter((c): c is Contact => !!c);
  const lead = people[0];
  const title = t.isGroup ? t.groupName ?? "Group" : lead?.name ?? t.fallbackName ?? t.subject ?? "Unknown";
  const who = join(...people.flatMap((c) => [c.name, ...c.emails, ...c.phones]), t.fallbackName);
  return {
    id: docId("thread", t.id), k: "thread", r: t.id, t: title.slice(0, 200),
    x: clip(join(t.subject, t.preview, t.summary), "thread"),
    fr: clip(who, "thread") || undefined, to: clip(who, "thread") || undefined,
    at: ms(t.lastMessageAt),
    ...(t.unread ? { u: 1 as const } : {}),
    ...(t.status === "trash" ? { tr: 1 as const } : {}),
  };
}

/** A person: found by name, company, role, address or number (a number also by its digits, so 082 finds +27 82). */
export function contactDoc(c: Contact): Doc {
  // Both forms, so 082 123 4567 and +27 82 123 4567 find the same person (their words are searched separately).
  const digits = c.phones.map(searchDigits).filter(Boolean).flatMap((d) => (/^27\d{9}$/.test(d) ? [d, `0${d.slice(2)}`] : [d]));
  return {
    id: docId("contact", c.id), k: "contact", r: c.id, t: c.name.slice(0, 200),
    x: clip(join(c.company, c.role, ...c.emails, ...c.phones, ...digits, ...(c.handles ?? []).map((h) => `@${h}`), c.organization?.name), "contact"),
    at: 0,
  };
}

/** A task, by title, notes and list; dated by when it is due. */
export function taskDoc(t: Task): Doc {
  return {
    id: docId("task", t.id), k: "task", r: t.id, t: t.title.slice(0, 200),
    x: clip(join(t.notes, t.listName), "task"), at: ms(t.dueAt),
    ...(t.completed ? { d: 1 as const } : {}),
  };
}

/** A note: its title and the start of its text (markdown reduced to plain lines). */
export function noteDoc(n: { id: string; title: string; body: string; excerpt?: string | null; updatedAt: string }): Doc {
  const text = n.body ? noteExcerpt(n.body, TEXT_CAP.note) : n.excerpt ?? "";
  return { id: docId("note", n.id), k: "note", r: n.id, t: (n.title || "Untitled").slice(0, 200), x: clip(text, "note"), at: ms(n.updatedAt) };
}

export interface EventRow {
  id: string;
  title: string | null;
  starts_at: string;
  location?: string | null;
  calendar_name?: string | null;
  description?: string | null;
  attendees?: unknown;
}

/** A calendar event, by title, place, notes, calendar and guests. */
export function eventDoc(e: EventRow): Doc {
  const guests = Array.isArray(e.attendees)
    ? e.attendees.flatMap((a: { name?: unknown; email?: unknown }) => [a?.name, a?.email].filter((v): v is string => typeof v === "string" && !sealed(v)))
    : [];
  // Some synced notes are still the HTML the provider sent: its tags are not words.
  const notes = e.description && !sealed(e.description) ? e.description.replace(/<[^>]*>/g, " ") : "";
  return { id: docId("event", e.id), k: "event", r: e.id, t: (e.title?.trim() || "No Title").slice(0, 200), x: clip(join(e.location, e.calendar_name, notes, ...guests), "event"), at: ms(e.starts_at) };
}

/** The columns a message needs to be indexed: no HTML, no reactions, nothing the search does not read. */
export interface MessageRow {
  id: string;
  thread_id: string;
  direction: string;
  sender_contact_id: string | null;
  sender_address: string | null;
  to_addresses: string[] | null;
  sent_at: string;
  subject: string | null;
  body_text: string | null;
  is_bulk?: boolean | null;
  provider_meta?: unknown;
  transcript?: string | null;
  attachments?: { id: string; filename: string; hidden?: boolean | null }[] | null;
}

/** The words of a message: WhatsApp text as sent; an email without its quoted history, signature and footer. */
export function bodyOf(row: Pick<MessageRow, "body_text" | "subject" | "is_bulk" | "provider_meta" | "transcript">): string {
  const whatsapp = typeof (row.provider_meta as { chat?: unknown } | null | undefined)?.chat === "string";
  let body = row.body_text ?? "";
  if (!whatsapp && body) {
    try { body = emailParts(body, null, row.subject, !!row.is_bulk).body; } catch { /* the raw text still searches */ }
  }
  return join(body, row.transcript);
}

/** A message, and a document for each file that came with it. */
export function messageDocs(row: MessageRow, people: People): Doc[] {
  const mine = row.direction === "outbound";
  const sender = mine ? "me" : row.sender_contact_id ? people.nameOf(row.sender_contact_id) : undefined;
  const from = join(sender, row.sender_address);
  const to = join(...(row.to_addresses ?? []), mine ? people.peersOf(row.thread_id) : "me");
  const at = ms(row.sent_at);
  // Hidden files are inline logos and signature images: not worth finding.
  const files = (row.attachments ?? []).filter((a) => !a.hidden && a.filename);
  const message: Doc = {
    id: docId("message", row.id), k: "message", r: row.id, th: row.thread_id,
    t: (row.subject ?? "").slice(0, 200), x: clip(bodyOf(row), "message"),
    fr: from.slice(0, 200) || undefined, to: to.slice(0, 400) || undefined, at,
    ...(files.length ? { a: 1 as const } : {}),
    ...(mine ? { me: 1 as const } : {}),
  };
  const fileDocs = files.map((a): Doc => ({
    id: docId("file", a.id), k: "file", r: a.id, th: row.thread_id, mi: row.id, t: a.filename.slice(0, 200), x: "",
    fr: from.slice(0, 200) || undefined, at, ...(mine ? { me: 1 as const } : {}),
  }));
  return [message, ...fileDocs];
}
