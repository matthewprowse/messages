"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { toast } from "sonner";
import type { Tables } from "@messages/db";
import type { Account, Attachment, Contact, Decision, Draft, ListFilter, Message, Priority, Profile, Rule, Task, Thread, ThreadStatus, Unsubscribe, View, WritingExample } from "./types";
import { useAuth } from "./auth";
import { supabase } from "./supabase";
import { attachmentRows, pendingAttachments, type OutboxUpload } from "./outbox-files";
import { keepName, loadContactGraph, mergeContactsRpc, mergeErrorText, splitContactRpc, undoMergeRpc } from "./contact-merging";
import { followMerges } from "./merging";
import {
  EMPTY_PROFILE, loadContacts, loadEverything, loadMessage, loadMessageAttachments, loadThread, loadThreadMessages, mapAttachment, mapDraft, mapAccount,
  mapMessage, mapThread, mapUnsubscribe, messageSentAt, patchMessage, profilePatch, type Loaded, type MessageRow, UNSUBSCRIBE_COLUMNS,
} from "./data";
import { openAddresses, openDrafts, openMessages, openTasks, openThreads } from "./open-rows";
import { isOverdue, isTempTask, mapTask, taskOfWrite, taskWriteFields, tempTaskId, withTicks, type PendingTick, type TaskForm } from "./tasks";
import { seal, userKeys } from "./vault";
import { encryptBytes } from "@messages/crypto";
import { FIELD } from "@messages/crypto/fields";
import { addressIndex, ruleTargetIndex } from "@messages/crypto/addresses";
import { sealAddress } from "./address-refs";
import { track } from "./analytics";
import { minutesBucket, wordOf, type Events } from "@messages/analytics";
import { draftEdit } from "@messages/analytics/draft";

export type DraftPhase = "thinking" | "streaming";

/**
 * What the AI said about a conversation's latest message (its prompt code and the traits stored with it: sender kind,
 * channel, length and so on, never any text), for usage analytics. Empty when unknown or the lookup fails.
 */
async function aiRecord(threadId: string): Promise<Record<string, unknown>> {
  try {
    const { data } = await supabase.from("message_ai").select("prompt_version, traits, messages!inner(thread_id)")
      .eq("messages.thread_id", threadId).order("created_at", { ascending: false }).limit(1).maybeSingle();
    const traits = data?.traits && typeof data.traits === "object" && !Array.isArray(data.traits) ? data.traits : {};
    return { ...(data?.prompt_version ? { prompt: data.prompt_version } : {}), ...traits };
  } catch {
    return {};
  }
}

/** A label you changed, against what you were shown, for the correction rates. Nothing is recorded when it did not change. */
function recordCorrection(threadId: string, field: "priority" | "junk", from: string, to: string) {
  if (from === to) return;
  void aiRecord(threadId).then((ai) => track("label_corrected", { field, from, to, ...ai } as Events["label_corrected"]));
}

/** Something done to conversations: which action, whether it had been read first, and how long after the last message. */
function recordAction(threads: Thread[], action: string) {
  for (const t of threads.slice(0, 3)) {
    const base = { action, opened_first: !t.unread, mins_since: minutesBucket(Math.max(0, (Date.now() - Date.parse(t.lastMessageAt)) / 60_000)) };
    void aiRecord(t.id).then((ai) => track("thread_action", { ...ai, ...base } as Events["thread_action"]));
  }
  if (threads.length > 3) track("thread_action", { action: `${action}_many`, opened_first: false, mins_since: 0 } as Events["thread_action"]);
}

/** How long the composer waits for an AI draft before giving up. */
const DRAFT_TIMEOUT_MS = 30_000;
/** A spoken request also goes up and is listened to first. */
const VOICE_DRAFT_TIMEOUT_MS = 45_000;

/** A recording of what a draft should say, sealed with your key and uploaded where only you and the AI
 *  worker can read it. Its path, or undefined when it could not be uploaded. */
async function uploadRecording(userId: string, audio: Blob): Promise<string | undefined> {
  const ext = audio.type.startsWith("audio/ogg") ? "ogg" : audio.type.startsWith("audio/mp4") ? "m4a" : "webm";
  const path = `${userId}/drafts/${crypto.randomUUID()}.${ext}`;
  try {
    const sealed = await encryptBytes(await userKeys(), FIELD.voiceInstruction, new Uint8Array(await audio.arrayBuffer()));
    const { error } = await supabase.storage.from("attachments").upload(path, new Blob([sealed], { type: "application/octet-stream" }), { contentType: "application/octet-stream" });
    return error ? undefined : path;
  } catch {
    return undefined;
  }
}
/** How long a conversation stays quiet before it gets a pre-draft, so a burst of messages gets one. */
const PRE_DRAFT_QUIET_MS = 30_000;
const PRE_DRAFT_DAYS = 7;

/** Whether a conversation might get a pre-draft (docs/PLAN.md, Pre-Drafting). The database decides, in
 *  request_auto_draft; this only saves asking about conversations that plainly do not qualify. */
function mayPreDraft(t: Thread, profile: Profile): boolean {
  const person = t.needsReply || t.category === "personal" || t.category === "work" || t.category === "needs_reply";
  const draftSince = !!t.draft && Date.parse(t.draft.generatedAt) > Date.parse(t.lastMessageAt);
  return profile.autoDraftTop && person && !t.isGroup && !t.junk && !t.lastFromMe && !draftSince && t.status !== "trash"
    && Date.now() - Date.parse(t.lastMessageAt) < PRE_DRAFT_DAYS * 86_400_000;
}

interface State {
  loading: boolean;
  threads: Thread[];
  /** Loaded messages by conversation, oldest first. */
  byThread: Record<string, Message[]>;
  contacts: Contact[];
  accounts: Account[];
  rules: Rule[];
  writingExamples: WritingExample[];
  profile: Profile;
  unsubscribes: Unsubscribe[];
  /** Tasks with a due date, for Calendar and the Summary. */
  tasks: Task[];
}

type Action =
  | { type: "loaded"; data: Loaded }
  | { type: "clear" }
  | { type: "upsertThread"; thread: Thread }
  | { type: "removeThread"; id: string }
  | { type: "patchThread"; id: string; patch: Partial<Thread> }
  | { type: "patchThreads"; ids: string[]; patch: Partial<Thread> }
  | { type: "setThreadMessages"; threadId: string; messages: Message[] }
  | { type: "mergeMessages"; threadId: string; messages: Message[] }
  | { type: "addMessage"; message: Message }
  | { type: "replaceMessage"; message: Message }
  | { type: "patchMessage"; threadId: string; id: string; row: { provider_meta?: unknown; body_text?: string | null; transcript?: string | null } }
  | { type: "upsertAttachment"; row: Tables<"attachments"> }
  | { type: "removeAttachment"; id: string }
  | { type: "upsertContacts"; contacts: Contact[] }
  | { type: "setDraft"; id: string; draft?: Draft }
  | { type: "feedback"; id: string; value: "important" | "not_important" }
  | { type: "upsertUnsubscribe"; unsubscribe: Unsubscribe }
  | { type: "removeUnsubscribe"; id: string }
  | { type: "upsertAccount"; account: Account }
  | { type: "patchAccount"; id: string; patch: Partial<Account> }
  | { type: "addRule"; rule: Rule }
  | { type: "removeRule"; id: string }
  | { type: "addExample"; example: WritingExample }
  | { type: "removeExample"; id: string }
  | { type: "patchProfile"; patch: Partial<Profile> }
  | { type: "setContactGraph"; contacts: Contact[]; participants: Map<string, string[]> }
  | { type: "upsertTask"; task: Task }
  | { type: "removeTask"; id: string }
  | { type: "patchTask"; id: string; patch: Partial<Task> }
  | { type: "reset" };

const initial: State = {
  loading: true,
  threads: [],
  byThread: {},
  contacts: [],
  accounts: [],
  rules: [],
  writingExamples: [],
  profile: EMPTY_PROFILE,
  unsubscribes: [],
  tasks: [],
};

const byTime = (a: Message, b: Message) => (a.sentAt < b.sentAt ? -1 : a.sentAt > b.sentAt ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/** Messages added to a conversation's list, or replacing the ones with the same id, kept in order. */
function withMessages(list: Message[] = [], incoming: Message[]): Message[] {
  const byId = new Map(list.map((m) => [m.id, m]));
  for (const m of incoming) byId.set(m.id, m);
  return [...byId.values()].sort(byTime);
}

const sameContact = (a: Contact, b: Contact) =>
  a.name === b.name && a.company === b.company && a.role === b.role && a.avatarPath === b.avatarPath && a.isCompany === b.isCompany &&
  a.organization?.id === b.organization?.id && a.organization?.name === b.organization?.name &&
  a.organization?.logoPath === b.organization?.logoPath &&
  a.emails.join() === b.emails.join() && a.phones.join() === b.phones.join();

/** The list with these contacts added or updated. The same array when nothing changed, so lookups built on it stay stable. */
function withContacts(list: Contact[], incoming: Contact[]): Contact[] {
  if (list.length === 0) return incoming;
  const byId = new Map(list.map((c) => [c.id, c]));
  let changed = false;
  for (const c of incoming) {
    const old = byId.get(c.id);
    if (old && sameContact(old, c)) continue;
    byId.set(c.id, c);
    changed = true;
  }
  return changed ? [...byId.values()] : list;
}

/** Changes one message's files wherever that message is loaded. */
function editFiles(s: State, messageId: string | null, edit: (files: Attachment[]) => Attachment[]): State {
  for (const [threadId, list] of Object.entries(s.byThread)) {
    const i = messageId ? list.findIndex((m) => m.id === messageId) : list.findIndex((m) => m.attachments?.length && edit(m.attachments) !== m.attachments);
    if (i < 0) continue;
    const before = list[i].attachments ?? [];
    const after = edit(before);
    if (after === before) return s;
    const next = [...list];
    next[i] = { ...list[i], attachments: after.length ? after : undefined };
    return { ...s, byThread: { ...s.byThread, [threadId]: next } };
  }
  return s;
}

function reducer(s: State, a: Action): State {
  switch (a.type) {
    case "loaded":
      // Contacts are merged, as a resync after a reconnect brings only the people in the listed threads.
      return { ...s, ...a.data, contacts: withContacts(s.contacts, a.data.contacts), loading: false };
    case "clear":
      return { ...initial, loading: false };
    case "upsertThread": {
      const exists = s.threads.some((t) => t.id === a.thread.id);
      return {
        ...s,
        threads: exists
          ? s.threads.map((t) => (t.id === a.thread.id ? { ...t, ...a.thread, draft: t.draft, feedback: t.feedback } : t))
          : [a.thread, ...s.threads],
      };
    }
    case "removeThread":
      return { ...s, threads: s.threads.filter((t) => t.id !== a.id) };
    case "patchThread":
      return { ...s, threads: s.threads.map((t) => (t.id === a.id ? { ...t, ...a.patch } : t)) };
    case "patchThreads": {
      const ids = new Set(a.ids);
      return { ...s, threads: s.threads.map((t) => (ids.has(t.id) ? { ...t, ...a.patch } : t)) };
    }
    case "setThreadMessages":
      return { ...s, byThread: { ...s.byThread, [a.threadId]: [...a.messages].sort(byTime) } };
    case "mergeMessages":
      return { ...s, byThread: { ...s.byThread, [a.threadId]: withMessages(s.byThread[a.threadId], a.messages) } };
    case "addMessage":
      if (s.byThread[a.message.threadId]?.some((m) => m.id === a.message.id)) return s;
      return { ...s, byThread: { ...s.byThread, [a.message.threadId]: withMessages(s.byThread[a.message.threadId], [a.message]) } };
    case "replaceMessage":
      return { ...s, byThread: { ...s.byThread, [a.message.threadId]: withMessages(s.byThread[a.message.threadId], [a.message]) } };
    case "patchMessage": {
      const list = s.byThread[a.threadId];
      const i = list?.findIndex((m) => m.id === a.id) ?? -1;
      if (i < 0) return s;
      const patched = patchMessage(list[i], a.row);
      if (patched === list[i]) return s;
      const next = [...list];
      next[i] = patched;
      return { ...s, byThread: { ...s.byThread, [a.threadId]: next } };
    }
    case "upsertAttachment": {
      const file = mapAttachment(a.row);
      const hidden = a.row.hidden;
      return editFiles(s, a.row.message_id, (files) => {
        const at = files.findIndex((f) => f.id === file.id);
        if (hidden) return at < 0 ? files : files.filter((f) => f.id !== file.id);
        return at < 0 ? [...files, file] : files.map((f) => (f.id === file.id ? { ...f, ...file } : f));
      });
    }
    case "removeAttachment":
      return editFiles(s, null, (files) => (files.some((f) => f.id === a.id) ? files.filter((f) => f.id !== a.id) : files));
    case "upsertContacts": {
      const contacts = withContacts(s.contacts, a.contacts);
      return contacts === s.contacts ? s : { ...s, contacts };
    }
    case "setDraft":
      return { ...s, threads: s.threads.map((t) => (t.id === a.id ? { ...t, draft: a.draft } : t)) };
    case "feedback": {
      const priority: Priority = a.value === "important" ? "important" : "low";
      return { ...s, threads: s.threads.map((t) => (t.id === a.id ? { ...t, feedback: a.value, priority } : t)) };
    }
    case "upsertUnsubscribe":
      return {
        ...s,
        unsubscribes: [...s.unsubscribes.filter((u) => u.id !== a.unsubscribe.id && u.sender !== a.unsubscribe.sender), a.unsubscribe],
      };
    case "removeUnsubscribe":
      return { ...s, unsubscribes: s.unsubscribes.filter((u) => u.id !== a.id) };
    case "upsertAccount":
      return s.accounts.some((x) => x.id === a.account.id)
        ? { ...s, accounts: s.accounts.map((x) => (x.id === a.account.id ? a.account : x)) }
        : { ...s, accounts: [...s.accounts, a.account] };
    case "patchAccount":
      return { ...s, accounts: s.accounts.map((x) => (x.id === a.id ? { ...x, ...a.patch } : x)) };
    case "addRule":
      return { ...s, rules: [a.rule, ...s.rules] };
    case "removeRule":
      return { ...s, rules: s.rules.filter((r) => r.id !== a.id) };
    case "addExample":
      return { ...s, writingExamples: [a.example, ...s.writingExamples] };
    case "removeExample":
      return { ...s, writingExamples: s.writingExamples.filter((w) => w.id !== a.id) };
    case "patchProfile":
      return { ...s, profile: { ...s.profile, ...a.patch } };
    case "setContactGraph":
      return { ...s, contacts: a.contacts, threads: s.threads.map((t) => ({ ...t, participantIds: a.participants.get(t.id) ?? [] })) };
    case "upsertTask": {
      // A task that lost its date has no day to show on.
      const others = s.tasks.filter((t) => t.id !== a.task.id);
      return { ...s, tasks: a.task.dueAt ? [...others, a.task] : others };
    }
    case "removeTask":
      return s.tasks.some((t) => t.id === a.id) ? { ...s, tasks: s.tasks.filter((t) => t.id !== a.id) } : s;
    case "patchTask":
      return { ...s, tasks: s.tasks.map((t) => (t.id === a.id ? { ...t, ...a.patch } : t)) };
    case "reset":
      return s; // not available on real data yet
  }
}

interface Ctx extends Omit<State, "byThread"> {
  dispatch: (action: Action) => void;
  contactById: (id: string) => Contact | undefined;
  threadById: (id: string) => Thread | undefined;
  /** Every loaded message, for search. */
  messages: Message[];
  /** Loaded messages and queued replies by conversation, oldest first. A list only changes when its conversation does. */
  messagesByThread: Map<string, Message[]>;
  messagesFor: (threadId: string) => Message[];
  messagesLoaded: (threadId: string) => boolean;
  /** Loads a conversation's newest messages, or with aroundMessageId every message from that one on. */
  loadMessages: (threadId: string, aroundMessageId?: string) => Promise<void>;
  /** Loads the page before the oldest loaded message. Resolves true when it added any. */
  loadOlderMessages: (threadId: string) => Promise<boolean>;
  /** Starts loading a conversation about to be opened. Does nothing once it is loaded or loading. */
  prefetchMessages: (threadId: string) => void;
  listThreads: (view: View, filter: ListFilter) => Thread[];
  notify: (text: string, undo?: () => void) => void;
  markRead: (id: string, read: boolean, opened?: boolean) => void;
  /** Archives one conversation or several, with one Undo toast. */
  archive: (ids: string | string[]) => void;
  /** Moves conversations to the mail provider's Bin (never deletes for good), with an Undo toast. */
  trash: (ids: string | string[]) => void;
  pin: (id: string, pinned: boolean) => void;
  /** Queues a reply. Resolves false when it could not be queued, so the composer keeps the text. */
  /** standalone leaves out the conversation's AI draft and Reply-to, for a message started elsewhere. */
  /** copies is Reply All (or an edited To and Cc): the reply goes to exactly those. Left out, the worker picks. */
  send: (threadId: string, body: string, fromAddress?: string, files?: OutboxUpload[], standalone?: boolean, copies?: { to: string[]; cc: string[] }) => Promise<boolean>;
  /** The message the next reply in each conversation answers, chosen with Reply on a message. */
  replyTo: Record<string, Message | undefined>;
  setReplyTo: (threadId: string, message: Message | null) => void;
  /** Reacts to a WhatsApp message, or removes your reaction with an empty emoji. Sent by the worker. */
  react: (message: Message, emoji: string) => void;
  /** Queues a new email. Resolves to the outbox row id, or null when it could not be queued. */
  composeEmail: (email: NewEmail) => Promise<string | null>;
  /** Queues a first WhatsApp message to one E.164 number. Resolves to the outbox row id, or null. */
  composeWhatsApp: (accountId: string, to: string, body: string, draftId?: string) => Promise<string | null>;
  /** Asks the AI to write (or with tone "edit", correct) a new message. Resolves to the draft's id; it arrives in composeDrafts. */
  generateComposeDraft: (request: ComposeDraftRequest) => Promise<string | null>;
  composeDrafts: Record<string, ComposeDraft | undefined>;
  /** Throws a new message's draft away (the dialog closed, or Undo), or with "revised", sets it aside for an edit of it. */
  discardComposeDraft: (id: string, status?: "discarded" | "revised") => void;
  /** New emails and WhatsApp chats queued this session, by outbox id. threadId arrives once it is stored. */
  composed: Record<string, ComposeStatus | undefined>;
  /** Re-reads a queued new email, for when a Realtime update is missed. */
  refreshCompose: (outboxId: string) => Promise<void>;
  /** Makes sure a conversation is in the list, loading it if it has only just been created. */
  ensureThread: (threadId: string) => Promise<boolean>;
  /** Saves the addresses an iCloud account sends from. Resolves false when it could not be saved. */
  saveSendAddresses: (accountId: string, addresses: string[]) => Promise<boolean>;
  /** Asks for a draft. decision is a guided drafting choice the draft must say. source is the text in the
   *  reply box: with tone "edit" it comes back lightly corrected, and with Shorter, More Formal or More
   *  Casual it is adjusted, instead of a new draft being written. audio is a recording of what the reply
   *  should say, in place of a typed instruction. */
  generateDraft: (threadId: string, tone?: Draft["tone"], instruction?: string, decision?: Decision, source?: string, audio?: Blob) => Promise<void>;
  discardDraft: (threadId: string) => void;
  /** Asks for a pre-draft when the conversation qualifies: on opening it, and while the app is open. */
  requestAutoDraft: (threadId: string) => Promise<void>;
  /** Moves conversations to or out of Junk, and email to or out of the provider's spam, with an Undo toast. */
  setJunk: (threadIds: string | string[], junk: boolean) => void;
  /** Queues unsubscribes for these senders. Resolves to how many were queued. */
  unsubscribe: (senders: { accountId: string; sender: string }[]) => Promise<number>;
  /** Records that the person unsubscribed on the sender's own page, for a request left at manual. */
  confirmUnsubscribe: (id: string) => void;
  drafting: Record<string, DraftPhase | undefined>;
  hydrated: boolean;
  giveFeedback: (id: string, value: "important" | "not_important") => void;
  /** Merges mergeId into keepId, with an Undo toast. Resolves to the merge id, or null when it failed. */
  mergeContacts: (keepId: string, mergeId: string, reason: "suggestion" | "manual", name?: string) => Promise<string | null>;
  /** Moves some of a contact's addresses and numbers to a new person. Resolves to their id, or null. */
  splitContact: (contactId: string, identityIds: string[], name: string) => Promise<string | null>;
  undoMerge: (mergeId: string) => Promise<boolean>;
  /** Reloads every contact after one is added or deleted, and the open conversations that involve these ids. */
  refreshContacts: (affected: string[]) => Promise<Contact[]>;
  /** Goes up after every merge, split or undo, so pages that load contacts themselves reload. */
  contactsVersion: number;
  /** Ticks a task off (done) or back on. Shown at once; the worker makes it at the provider, and a failure puts it back with a toast. */
  tickTask: (task: Task, done: boolean, via: "calendar" | "details" | "summary") => void;
  /** Makes a task at its provider. It shows at once; a failure takes it away again with a message. */
  createTask: (form: TaskForm) => void;
  /** Changes a task's title, notes, date or priority at its provider, shown at once and put back on failure. */
  editTask: (task: Task, form: TaskForm) => void;
  /** Deletes a task at its provider. It goes at once and comes back on failure. */
  deleteTask: (task: Task) => void;
}

const AppContext = createContext<Ctx | null>(null);
const rank: Record<Priority, number> = { urgent: 0, important: 1, normal: 2, low: 3 };
const NO_MESSAGES: Message[] = [];

// Junk splits in two: Subscriptions (it offers a way to unsubscribe) and Junk (spam, cold outreach).
const inView = (t: Thread, view: View) =>
  view === "junk" ? t.junk && !t.subscription : view === "subscriptions" ? t.junk && t.subscription : !t.junk;
// Once you have answered, a conversation does not need you until they write again.
const isPriority = (t: Thread) => (t.priority === "urgent" || t.priority === "important") && !t.lastFromMe && t.category !== "newsletter" && t.category !== "notification";

function inFilter(t: Thread, filter: ListFilter) {
  switch (filter) {
    case "unread": return t.unread;
    case "email": return t.channel === "email";
    case "whatsapp": return t.channel === "whatsapp";
    case "waiting": return isWaiting(t);
    default: return true;
  }
}

/** Waiting: you wrote last, your message expects an answer, and none has come for WAITING_DAYS. */
const WAITING_DAYS = 2;
const isWaiting = (t: Thread) => t.lastFromMe && !!t.waiting && Date.now() - Date.parse(t.lastMessageAt) >= WAITING_DAYS * 86_400_000;

type MailAction = "read" | "unread" | "archive" | "unarchive" | "trash" | "untrash" | "spam" | "unspam";

function threadsIn(threads: Thread[], ids: string | string[]): Thread[] {
  const wanted = new Set(Array.isArray(ids) ? ids : [ids]);
  return threads.filter((t) => wanted.has(t.id));
}

/** The state as the screens read it: messages are offered per conversation instead. */
function listState({ byThread, ...rest }: State): Omit<State, "byThread"> {
  void byThread;
  return rest;
}

/** Only email conversations have a mail server to tell. */
function emailIds(threads: Thread[]): string[] {
  return threads.filter((t) => t.channel === "email").map((t) => t.id);
}

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

function composeStatusOf(row: Pick<Tables<"outbox">, "status" | "thread_id" | "error">): ComposeStatus {
  return { status: row.status as ComposeStatus["status"], threadId: row.thread_id ?? undefined, error: row.error ?? undefined };
}

interface PendingSend {
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
async function attachToOutbox(outboxId: string, files: OutboxUpload[]): Promise<boolean> {
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

/**
 * Waits for the worker to settle a queued tick, by the row's Realtime updates with a poll as a safety net, like
 * Calendar's followUpdate. Resolves with the row then (done, or failed with the reason), or as failed after giveUpMs.
 */
function followTaskUpdate(id: string, giveUpMs = 60_000, pollMs = 2000, giveUpText = "Ticking the task is taking too long. Check that the worker is running."): Promise<{ status: string; error: string | null }> {
  return new Promise((resolve) => {
    let finished = false;
    const finish = (row: { status: string; error: string | null }) => {
      if (finished) return;
      finished = true;
      clearInterval(poll);
      clearTimeout(giveUp);
      void supabase.removeChannel(channel);
      resolve(row);
    };
    const apply = (row: { status: string; error: string | null } | null) => {
      if (row && (row.status === "done" || row.status === "failed")) finish(row);
    };
    const channel = supabase
      .channel(`task_updates-${id}`)
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "task_updates", filter: `id=eq.${id}` }, (payload) => apply(payload.new as { status: string; error: string | null }))
      .subscribe();
    const poll = setInterval(() => void supabase.from("task_updates").select("status, error").eq("id", id).maybeSingle().then(({ data }) => apply(data)), pollMs);
    const giveUp = setTimeout(() => finish({ status: "failed", error: giveUpText }), giveUpMs);
  });
}

export function AppProvider({ children }: { children: React.ReactNode }) {
  const { session } = useAuth();
  // The user id, not the session: the session object changes on every hourly token refresh.
  const ready = session !== undefined;
  const userId = session?.user.id ?? null;
  const [state, rawDispatch] = useReducer(reducer, initial);
  const [drafting, setDrafting] = useState<Record<string, DraftPhase | undefined>>({});
  const [composeDrafts, setComposeDrafts] = useState<Record<string, ComposeDraft | undefined>>({});
  // New messages' drafts asked for here and still awaited; others (another tab) are not this tab's.
  const composeWaitRef = useRef(new Set<string>());
  // The draft each conversation is waiting on, so a timeout only gives up on a request still unanswered.
  const draftWaitRef = useRef<Record<string, string | undefined>>({});
  /** How many drafts were asked for in a conversation since its last reply, for how often people ask again. */
  const draftAskRef = useRef<Record<string, number | undefined>>({});
  const [hydrated, setHydrated] = useState(false);
  const [loadedThreadIds, setLoadedThreadIds] = useState<Set<string>>(new Set());
  // Replies queued in the outbox, shown in the conversation until the sent email is imported.
  const [pending, setPending] = useState<PendingSend[]>([]);
  const [composed, setComposed] = useState<Record<string, ComposeStatus | undefined>>({});
  // Contacts merged away this session, to the contact each went into.
  const [mergedInto, setMergedInto] = useState<Record<string, string | undefined>>({});
  const [contactsVersion, setContactsVersion] = useState(0);
  const stateRef = useRef(state);
  stateRef.current = state;
  const loadedRef = useRef(loadedThreadIds);
  loadedRef.current = loadedThreadIds;
  const pendingRef = useRef(pending);
  pendingRef.current = pending;
  const composedRef = useRef(composed);
  composedRef.current = composed;
  // Conversations with older messages left to load, and loads in flight.
  const moreRef = useRef(new Map<string, boolean>());
  const loadingRef = useRef(new Map<string, Promise<void>>());
  const olderRef = useRef(new Set<string>());
  const contactsForRef = useRef<string | null>(null);
  // Failed tries at the deferred contacts load, which re-runs it after a pause.
  const [contactsTries, setContactsTries] = useState(0);

  const contactMap = useMemo(() => new Map(state.contacts.map((c) => [c.id, c])), [state.contacts]);
  const threadMap = useMemo(() => new Map(state.threads.map((t) => [t.id, t])), [state.threads]);
  const threadMapRef = useRef(threadMap);
  threadMapRef.current = threadMap;

  // Pre-drafts: one per conversation's latest message, asked for once the app has seen it settle (its
  // triage included, which changes the key), never again for the same state.
  const preDraftAskedRef = useRef(new Set<string>());
  const preDraftTimersRef = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const requestAutoDraft = useCallback(async (threadId: string) => {
    const t = threadMapRef.current.get(threadId);
    if (!userId || !t || !mayPreDraft(t, stateRef.current.profile)) return;
    const key = `${t.id}:${t.lastMessageAt}:${t.category}:${t.needsReply}`;
    if (preDraftAskedRef.current.has(key)) return;
    preDraftAskedRef.current.add(key);
    const { data } = await supabase.rpc("request_auto_draft", { p_thread: threadId });
    if (data) track("draft_requested", { tone: "default", source: "auto", channel: t.channel });
  }, [userId]);
  // While the app is open and in view, a conversation that changed is asked about once it has been
  // quiet for PRE_DRAFT_QUIET_MS. With the app closed or hidden, opening the conversation asks instead.
  const schedulePreDraft = useCallback((threadId: string) => {
    const timers = preDraftTimersRef.current;
    clearTimeout(timers.get(threadId));
    timers.set(threadId, setTimeout(() => {
      timers.delete(threadId);
      if (document.visibilityState === "visible") void requestAutoDraft(threadId);
    }, PRE_DRAFT_QUIET_MS));
  }, [requestAutoDraft]);
  useEffect(() => {
    const timers = preDraftTimersRef.current;
    return () => { for (const t of timers.values()) clearTimeout(t); timers.clear(); };
  }, [userId]);

  useEffect(() => { setHydrated(true); }, []);

  const notify = useCallback((text: string, undo?: () => void) => {
    toast(text, undo ? { action: { label: "Undo", onClick: undo } } : undefined);
  }, []);

  const saveFailed = useCallback(() => { toast("Could not save that change. Check your connection and try again."); }, []);

  // Load everything once signed in; clear on sign-out.
  useEffect(() => {
    if (!ready) return;
    if (!userId) {
      rawDispatch({ type: "clear" });
      setLoadedThreadIds(new Set());
      setPending([]);
      setComposed({});
      moreRef.current.clear();
      contactsForRef.current = null;
      return;
    }
    let cancelled = false;
    loadEverything()
      .then((data) => { if (!cancelled) rawDispatch({ type: "loaded", data }); })
      .catch(() => {
        if (cancelled) return;
        rawDispatch({ type: "clear" });
        toast("Could not load your conversations.");
      });
    return () => { cancelled = true; };
  }, [ready, userId]);

  // The list arrives with the people in it. Everyone else (for search, reactions and new messages)
  // loads once the list has been drawn.
  useEffect(() => {
    if (state.loading || !userId || contactsForRef.current === userId) return;
    contactsForRef.current = userId;
    let done = false;
    const timer = setTimeout(() => {
      loadContacts()
        .then((contacts) => { if (!done) rawDispatch({ type: "upsertContacts", contacts }); })
        .catch(() => {
          contactsForRef.current = null;
          if (done) return;
          if (contactsTries < 3) setTimeout(() => setContactsTries((n) => n + 1), 2000 * 2 ** contactsTries);
          else toast("Could not load all your contacts. Reload to try again.");
        })
        .finally(() => { done = true; });
    }, 0);
    return () => {
      clearTimeout(timer);
      if (!done) { done = true; contactsForRef.current = null; }
    };
  }, [state.loading, userId, contactsTries]);

  // Live updates: the sync worker writes to Supabase and changes arrive here within a second or so.
  // Rows are built from the payload, so a change costs no extra request unless the payload is cut short.
  useEffect(() => {
    if (!userId) return;

    /** A new message from its Realtime row. Large rows arrive without their big columns, so those are fetched. */
    async function arrived(row: Tables<"messages">, cut: boolean): Promise<Message | null> {
      try {
        if (cut || row.body_text === undefined || row.body_html === undefined) return await loadMessage(row.id);
        const attachments = await loadMessageAttachments(row.id);
        const [opened] = await openMessages([{ ...row }]);
        return mapMessage({ ...(opened as Omit<MessageRow, "attachments">), attachments });
      } catch {
        return null;
      }
    }

    // After a dropped connection, catch up once on what changed while it was down.
    async function resync() {
      try {
        rawDispatch({ type: "loaded", data: await loadEverything() });
      } catch {
        return;
      }
      const before = new Set(Object.values(stateRef.current.byThread).flatMap((list) => list.map((m) => m.id)));
      const sentIn = new Set<string>();
      await Promise.all([...loadedRef.current].map(async (threadId) => {
        const page = await loadThreadMessages(threadId).catch(() => null);
        if (!page) return;
        rawDispatch({ type: "mergeMessages", threadId, messages: page.messages });
        if (page.messages.some((m) => m.from === "me" && !before.has(m.id))) sentIn.add(threadId);
      }));
      const outboxIds = [...pendingRef.current.map((p) => p.id), ...Object.keys(composedRef.current)];
      const { data } = outboxIds.length ? await supabase.from("outbox").select("id, status, thread_id, error").in("id", outboxIds) : { data: [] };
      const rows = new Map((data ?? []).map((r) => [r.id, r]));
      setComposed((c) => Object.fromEntries(Object.entries(c).map(([id, v]) => [id, rows.has(id) ? composeStatusOf(rows.get(id)!) : v])));
      setPending((p) => p
        .map((x) => { const r = rows.get(x.id); return r ? { ...x, status: r.status as PendingSend["status"], error: r.error ?? undefined } : x; })
        .filter((x) => !(x.status === "sent" && sentIn.has(x.threadId))));
    }

    // Changes arrive in bursts (a sync writes many rows at once). They are collected for a moment and applied
    // together, a row changed twice in that moment once, so a burst costs one pass instead of one per change.
    // Within a pass, conversations are applied before their messages, and those before everything else.
    const BATCH_MS = 250;
    const queue = new Map<string, { rank: number; run: () => Promise<void> | void }>();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let flushing: Promise<void> = Promise.resolve();
    let stopped = false;
    async function flush() {
      timer = undefined;
      const batch = [...queue.values()];
      queue.clear();
      for (let rank = 0; rank <= 3 && !stopped; rank++) {
        await Promise.all(batch.filter((c) => c.rank === rank).map((c) => Promise.resolve().then(c.run).catch(() => undefined)));
      }
    }
    function queued(key: string, rank: number, run: () => Promise<void> | void) {
      queue.set(key, { rank, run }); // a repeat of the same key keeps its place and carries the newest row
      timer ??= setTimeout(() => { flushing = flushing.then(flush); }, BATCH_MS);
    }
    // Realtime applies a row filter to inserts and updates only; a deletion carries just the id.
    const mine = `user_id=eq.${userId}`;

    let dropped = false;
    const channel = supabase
      .channel(`inbox-${userId}`)
      .on("postgres_changes", { event: "DELETE", schema: "public", table: "threads" }, (payload) => {
        rawDispatch({ type: "removeThread", id: (payload.old as { id: string }).id });
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "threads", filter: mine }, (payload) => {
        if (payload.eventType === "DELETE") return;
        const changed = payload.new as Tables<"threads">;
        queued(`thread:${changed.id}`, 0, async () => {
          const row = (await openThreads([changed]))[0];
          const existing = threadMapRef.current.get(row.id);
          if (existing) {
            rawDispatch({ type: "upsertThread", thread: mapThread(row, existing.participantIds, existing.provider) });
            schedulePreDraft(row.id);
            return;
          }
          if (row.status === "trash") return; // deleted conversations are not shown
          const loaded = await loadThread(row.id).catch(() => null);
          if (!loaded) return;
          rawDispatch({ type: "upsertContacts", contacts: loaded.contacts });
          rawDispatch({ type: "upsertThread", thread: loaded.thread });
          schedulePreDraft(row.id);
        });
      })
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "messages", filter: mine }, (payload) => {
        const row = payload.new as Tables<"messages">;
        queued(`message:${row.id}`, 1, async () => {
          // Your sent reply has been imported, so its placeholder can go, in the same render as the message.
          const dropSent = () => {
            if (row.direction === "outbound") setPending((p) => p.filter((x) => !(x.threadId === row.thread_id && x.status === "sent")));
          };
          if (!loadedRef.current.has(row.thread_id)) { dropSent(); return; } // loaded fresh when the conversation is opened
          const message = await arrived(row, !!payload.errors?.length);
          if (message) rawDispatch({ type: "addMessage", message });
          dropSent();
        });
      })
      // Edits, deletions and reactions change a stored message. Read state changes arrive here too and change nothing shown.
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "messages", filter: mine }, (payload) => {
        const changed = payload.new as Partial<Tables<"messages">> & { id: string; thread_id: string };
        queued(`message-edit:${changed.id}`, 2, async () => {
          const [row] = await openMessages([changed]);
          if (loadedRef.current.has(row.thread_id)) rawDispatch({ type: "patchMessage", threadId: row.thread_id, id: row.id, row });
        });
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "drafts", filter: mine }, (payload) => {
        if (payload.eventType === "DELETE") return;
        const changed = payload.new as Tables<"drafts">;
        if (!changed.thread_id) {
          // A new message's draft goes to the dialog that asked for it, straight away.
          if (!composeWaitRef.current.has(changed.id) || changed.status === "pending") return;
          void openDrafts([changed]).then(([row]) => {
            if (!composeWaitRef.current.delete(row.id)) return;
            if (row.status === "active") {
              track("draft_shown", { tone: row.tone, channel: row.subject ? "email" : "whatsapp", ms: Math.max(0, Date.parse(row.updated_at) - Date.parse(row.created_at)), auto: false });
              setComposeDrafts((c) => ({ ...c, [row.id]: { status: "active", body: row.body, subject: row.subject ?? undefined, instruction: row.instruction ?? undefined } }));
            } else if (row.status === "failed") {
              setComposeDrafts((c) => ({ ...c, [row.id]: { status: "failed", error: row.error ?? "The draft could not be written." } }));
            }
          });
          return;
        }
        const threadId = changed.thread_id;
        // A draft someone is waiting for is shown the moment it arrives, not with the next batch.
        const waited = draftWaitRef.current[threadId] === changed.id;
        (waited ? (key: string, rank: number, run: () => Promise<void>) => void run() : queued)(`draft:${changed.id}`, 3, async () => {
          const [row] = await openDrafts([changed]);
          if (row.status === "active") {
            const t = threadMapRef.current.get(threadId);
            if (t && t.draft?.id !== row.id) {
              track("draft_shown", { tone: row.tone, channel: t.channel, ms: Math.max(0, Date.parse(row.updated_at) - Date.parse(row.created_at)), auto: row.auto });
            }
            rawDispatch({ type: "setDraft", id: threadId, draft: mapDraft(row) });
            setDrafting((d) => ({ ...d, [threadId]: undefined }));
            if (draftWaitRef.current[threadId] === row.id) delete draftWaitRef.current[threadId];
          } else if (row.status === "failed") {
            // A draft already given up on here has had its own message.
            if (draftWaitRef.current[threadId] !== row.id) return;
            delete draftWaitRef.current[threadId];
            track("draft_failed", { code: "failed", channel: threadMapRef.current.get(threadId)?.channel ?? "email" });
            toast(row.error ?? "The draft could not be written.");
            setDrafting((d) => ({ ...d, [threadId]: undefined }));
          } else if (row.status === "discarded" || row.status === "sent" || row.status === "expired" || row.status === "revised") {
            const current = threadMapRef.current.get(threadId)?.draft;
            if (current?.id === row.id) rawDispatch({ type: "setDraft", id: threadId });
          }
        });
      })
      .on("postgres_changes", { event: "DELETE", schema: "public", table: "unsubscribes" }, (payload) => {
        rawDispatch({ type: "removeUnsubscribe", id: (payload.old as { id: string }).id });
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "unsubscribes", filter: mine }, (payload) => {
        if (payload.eventType === "DELETE") return;
        const changed = payload.new as Tables<"unsubscribes">;
        queued(`unsubscribe:${changed.id}`, 3, async () => {
          const u = mapUnsubscribe(await openAddresses(changed));
          rawDispatch({ type: "upsertUnsubscribe", unsubscribe: u });
          if (u.status === "manual") toast(`${u.sender} needs you to confirm on their page.`);
          if (u.status === "failed") toast(u.error ?? `Could not unsubscribe from ${u.sender}.`);
        });
      })
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "outbox", filter: mine }, (payload) => {
        const row = payload.new as Tables<"outbox">;
        queued(`outbox:${row.id}`, 3, () => {
          if (row.status === "failed") toast(row.error ?? (row.account_id && !row.thread_id ? "The email could not be sent." : "The reply could not be sent."));
          setComposed((c) => (c[row.id] ? { ...c, [row.id]: composeStatusOf(row) } : c));
          setPending((p) => p.map((x) => (x.id === row.id ? { ...x, status: row.status as PendingSend["status"], error: row.error ?? undefined } : x)));
        });
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "accounts", filter: mine }, (payload) => {
        if (payload.eventType === "DELETE") return;
        const changed = payload.new as Tables<"accounts">;
        queued(`account:${changed.id}`, 3, async () => {
            rawDispatch({ type: "upsertAccount", account: mapAccount(await openAddresses(changed)) });
        });
      })
      .subscribe((status) => {
        if (status === "SUBSCRIBED") {
          if (dropped) void resync();
          dropped = false;
        } else {
          dropped = true; // CHANNEL_ERROR, TIMED_OUT or CLOSED; the client rejoins by itself
        }
      });

    // Files saved after their message arrived, such as WhatsApp photos, appear without a reload. On its
    // own channel, so the inbox keeps working if this table is not published for Realtime.
    const files = supabase
      .channel(`files-${userId}`)
      .on("postgres_changes", { event: "DELETE", schema: "public", table: "attachments" }, (payload) => {
        rawDispatch({ type: "removeAttachment", id: (payload.old as { id: string }).id });
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "attachments", filter: mine }, (payload) => {
        if (payload.eventType === "DELETE") return;
        const row = payload.new as Tables<"attachments">;
        // The file's name arrives encrypted.
        queued(`file:${row.id}`, 1, async () => rawDispatch({ type: "upsertAttachment", row: (await openAddresses([{ ...row }]))[0] }));
      })
      // Refused while the table is not published, so it stops instead of rejoining forever. A resync
      // after a dropped connection reloads files with their messages anyway.
      .subscribe((status) => { if (status === "CHANNEL_ERROR") void supabase.removeChannel(files); });

    // Tasks the worker stores or changes, on their own channel for the same reason. A resync reloads them too.
    const taskChannel = supabase
      .channel(`tasks-${userId}`)
      .on("postgres_changes", { event: "DELETE", schema: "public", table: "tasks" }, (payload) => {
        rawDispatch({ type: "removeTask", id: (payload.old as { id: string }).id });
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "tasks", filter: mine }, (payload) => {
        if (payload.eventType === "DELETE") return;
        const changed = payload.new as Tables<"tasks">;
        queued(`task:${changed.id}`, 3, async () => {
          const [row] = await openTasks([{ ...changed }]);
          rawDispatch({ type: "upsertTask", task: mapTask(row) });
        });
      })
      .subscribe((status) => { if (status === "CHANNEL_ERROR") void supabase.removeChannel(taskChannel); });

    return () => {
      stopped = true;
      clearTimeout(timer);
      supabase.removeChannel(channel);
      supabase.removeChannel(files);
      supabase.removeChannel(taskChannel);
    };
  }, [userId, schedulePreDraft]);

  /**
   * Applies a change on screen straight away, then saves it. Components call dispatch as before;
   * the database writes live here.
   */
  const dispatch = useCallback((action: Action) => {
    if (!userId) return;
    switch (action.type) {
      case "addRule": {
        const rule = { ...action.rule, id: crypto.randomUUID() };
        track("feature_used", { feature: "priority_rule", detail: action.rule.kind });
        rawDispatch({ type: "addRule", rule });
        // Matched on the target's index, which is worked out here: the database cannot read the target.
        void userKeys()
          .then(async (keys) => ({ target: await sealAddress(rule.target), target_index: await ruleTargetIndex(keys, rule.target) }))
          .then((stored) => supabase.from("priority_rules").insert({ id: rule.id, user_id: userId, kind: rule.kind, ...stored }))
          .then(({ error }) => { if (error) { rawDispatch({ type: "removeRule", id: rule.id }); saveFailed(); } }, () => { rawDispatch({ type: "removeRule", id: rule.id }); saveFailed(); });
        return;
      }
      case "removeRule":
        rawDispatch(action);
        supabase.from("priority_rules").delete().eq("id", action.id).then(({ error }) => { if (error) saveFailed(); });
        return;
      case "addExample": {
        const example = { ...action.example, id: crypto.randomUUID() };
        rawDispatch({ type: "addExample", example });
        // The situation and the text are sealed in the browser (fields writingSituation and writingBody).
        void Promise.all([seal(FIELD.writingSituation, example.context), seal(FIELD.writingBody, example.text)])
          .then(([situation, body]) => supabase.from("writing_examples").insert({ id: example.id, user_id: userId, situation, body }))
          .then(({ error }) => { if (error) { rawDispatch({ type: "removeExample", id: example.id }); saveFailed(); } }, () => { rawDispatch({ type: "removeExample", id: example.id }); saveFailed(); });
        return;
      }
      case "removeExample":
        rawDispatch(action);
        supabase.from("writing_examples").delete().eq("id", action.id).then(({ error }) => { if (error) saveFailed(); });
        return;
      case "patchProfile":
        // Which settings changed, never their values.
        for (const key of Object.keys(action.patch)) {
          const setting = wordOf(key);
          if (setting) track("setting_changed", { setting });
        }
        rawDispatch(action);
        supabase.from("profiles").upsert({ user_id: userId, ...profilePatch(action.patch) }, { onConflict: "user_id" })
          .then(({ error }) => { if (error) saveFailed(); });
        return;
      case "patchAccount":
        rawDispatch(action);
        if (action.patch.nickname !== undefined) {
          supabase.from("accounts").update({ nickname: action.patch.nickname || null }).eq("id", action.id).then(({ error }) => { if (error) saveFailed(); });
        }
        if (action.patch.status === "disconnected") {
          // The sync worker notices within 30 seconds and stops that account.
          supabase.from("accounts").update({ status: "disconnected" }).eq("id", action.id).then(({ error }) => { if (error) saveFailed(); });
        }
        return;
      case "reset":
        toast("Not available yet.");
        return;
      default:
        rawDispatch(action);
    }
  }, [userId, saveFailed]);

  // Map lookups, as rows and bubbles call these many times per render. A contact merged away this
  // session still resolves, to the contact it was merged into.
  const contactById = useCallback(
    (id: string) => contactMap.get(id) ?? (mergedInto[id] ? contactMap.get(followMerges(id, mergedInto)) : undefined),
    [contactMap, mergedInto],
  );
  const threadById = useCallback((id: string) => threadMap.get(id), [threadMap]);

  const messages = useMemo(() => Object.values(state.byThread).flat(), [state.byThread]);
  // Queued replies follow the stored messages. A conversation without any keeps its stored list as is.
  const messagesByThread = useMemo(() => {
    const queued = new Map<string, Message[]>();
    for (const p of pending) {
      const m: Message = {
        id: `outbox:${p.id}`,
        threadId: p.threadId,
        from: "me",
        sentAt: p.createdAt,
        body: p.body,
        attachments: p.attachments,
        sendState: p.status === "failed" ? "failed" : "sending",
        sendError: p.error,
      };
      queued.set(p.threadId, [...(queued.get(p.threadId) ?? []), m]);
    }
    const out = new Map(Object.entries(state.byThread));
    for (const [threadId, list] of queued) out.set(threadId, [...(out.get(threadId) ?? []), ...list]);
    return out;
  }, [state.byThread, pending]);
  const messagesFor = useCallback((threadId: string) => messagesByThread.get(threadId) ?? NO_MESSAGES, [messagesByThread]);
  const messagesLoaded = useCallback((threadId: string) => loadedThreadIds.has(threadId), [loadedThreadIds]);

  const loadMessages = useCallback((threadId: string, aroundMessageId?: string) => {
    const key = aroundMessageId ? `${threadId}:${aroundMessageId}` : threadId;
    const running = loadingRef.current.get(key);
    if (running) return running;
    const task = (async () => {
      try {
        const from = aroundMessageId ? await messageSentAt(threadId, aroundMessageId) : null;
        if (aroundMessageId && !from) return;
        // A jump into a loaded conversation fetches only the stretch older than what is there.
        const oldest = from && loadedRef.current.has(threadId) ? stateRef.current.byThread[threadId]?.[0] : undefined;
        const page = await loadThreadMessages(threadId, from ? { from, before: oldest } : {});
        // A jump keeps what is loaded; a fresh load replaces it.
        rawDispatch({ type: from ? "mergeMessages" : "setThreadMessages", threadId, messages: page.messages });
        moreRef.current.set(threadId, page.more);
        setLoadedThreadIds((prev) => (prev.has(threadId) ? prev : new Set(prev).add(threadId)));
      } catch {
        toast("Could not load this conversation.");
      } finally {
        loadingRef.current.delete(key);
      }
    })();
    loadingRef.current.set(key, task);
    return task;
  }, []);

  const loadOlderMessages = useCallback(async (threadId: string) => {
    const oldest = stateRef.current.byThread[threadId]?.[0];
    if (!oldest || !moreRef.current.get(threadId) || olderRef.current.has(threadId)) return false;
    olderRef.current.add(threadId);
    try {
      const page = await loadThreadMessages(threadId, { before: oldest });
      moreRef.current.set(threadId, page.more);
      if (page.messages.length === 0) return false;
      rawDispatch({ type: "mergeMessages", threadId, messages: page.messages });
      return true;
    } catch {
      toast("Could not load earlier messages.");
      return false;
    } finally {
      olderRef.current.delete(threadId);
    }
  }, []);

  const prefetchMessages = useCallback((threadId: string) => {
    if (!loadedRef.current.has(threadId)) void loadMessages(threadId);
  }, [loadMessages]);

  const listThreads = useCallback(
    (view: View, filter: ListFilter) =>
      state.threads
        .filter((t) => t.status === "inbox" && inView(t, view) && (view !== "priority" || isPriority(t)) && inFilter(t, filter))
        .sort((a, b) => {
          if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
          if (view === "priority" && rank[a.priority] !== rank[b.priority]) return rank[a.priority] - rank[b.priority];
          return b.lastMessageAt.localeCompare(a.lastMessageAt);
        }),
    [state.threads],
  );

  // Changes the mail server should know about are queued for the sync worker, which applies them there.
  const queueMailAction = useCallback((threadId: string | string[], action: MailAction) => {
    const ids = Array.isArray(threadId) ? threadId : [threadId];
    if (ids.length === 0) return;
    supabase.from("mail_actions").insert(ids.map((thread_id) => ({ thread_id, action }))).then(({ error }) => { if (error) saveFailed(); });
  }, [saveFailed]);

  // Read state is saved here and sent back to the mail server.
  const markRead = useCallback((id: string, read: boolean, opened = false) => {
    const prev = threadMapRef.current.get(id);
    if (prev && !opened && prev.unread === read) recordAction([prev], read ? "read" : "unread");
    const unreadCount = read ? 0 : Math.max(1, prev?.unreadCount ?? 0);
    rawDispatch({ type: "patchThread", id, patch: { unread: !read, unreadCount } });
    if (prev?.channel === "email") queueMailAction(id, read ? "read" : "unread");
    // WhatsApp read receipts only ever follow opening the chat; the worker checks the Settings switch.
    else if (prev?.channel === "whatsapp" && read && opened) queueMailAction(id, "read");
    // A Teams chat is marked read in Teams only when you open it here, never by Mark as Read.
    else if (prev?.channel === "teams" && read && opened) queueMailAction(id, "read");
    // Instagram is told you saw a thread only when you open it here.
    else if (prev?.channel === "instagram" && read && opened) queueMailAction(id, "read");
    (async () => {
      if (read) {
        const [a, b] = await Promise.all([
          supabase.from("messages").update({ is_read: true }).eq("thread_id", id).eq("is_read", false),
          supabase.from("threads").update({ unread_count: 0 }).eq("id", id),
        ]);
        if (a.error || b.error) saveFailed();
      } else {
        const latest = await supabase.from("messages").select("id").eq("thread_id", id).eq("direction", "inbound")
          .order("sent_at", { ascending: false }).limit(1).maybeSingle();
        if (latest.data) await supabase.from("messages").update({ is_read: false }).eq("id", latest.data.id);
        const b = await supabase.from("threads").update({ unread_count: unreadCount }).eq("id", id);
        if (latest.error || b.error) saveFailed();
      }
    })();
  }, [saveFailed, queueMailAction]);

  const pin = useCallback((id: string, pinned: boolean) => {
    const before = threadMapRef.current.get(id);
    if (before) recordAction([before], pinned ? "pin" : "unpin");
    rawDispatch({ type: "patchThread", id, patch: { pinned } });
    supabase.from("threads").update({ pinned }).eq("id", id).then(({ error }) => { if (error) saveFailed(); });
  }, [saveFailed]);

  const saveStatus = useCallback((ids: string[], status: ThreadStatus) => {
    if (ids.length === 0) return;
    rawDispatch({ type: "patchThreads", ids, patch: { status } });
    supabase.from("threads").update({ status }).in("id", ids).then(({ error }) => { if (error) saveFailed(); });
  }, [saveFailed]);

  // Undo puts each conversation back where it was.
  const restoreStatus = useCallback((before: Thread[]) => {
    for (const status of new Set(before.map((t) => t.status))) saveStatus(before.filter((t) => t.status === status).map((t) => t.id), status);
  }, [saveStatus]);

  const archive = useCallback((ids: string | string[]) => {
    const before = threadsIn(stateRef.current.threads, ids).filter((t) => t.status !== "archived");
    if (before.length === 0) return;
    recordAction(before, "archive");
    saveStatus(before.map((t) => t.id), "archived");
    queueMailAction(emailIds(before), "archive");
    notify(before.length === 1 ? "Archived" : `Archived ${before.length} conversations`, () => {
      restoreStatus(before);
      queueMailAction(emailIds(before.filter((t) => t.status === "inbox")), "unarchive");
    });
  }, [notify, saveStatus, restoreStatus, queueMailAction]);

  // Delete moves email to the provider's Bin, so Undo, or the provider itself, can bring it back.
  const trash = useCallback((ids: string | string[]) => {
    const before = threadsIn(stateRef.current.threads, ids).filter((t) => t.status !== "trash");
    if (before.length === 0) return;
    recordAction(before, "trash");
    saveStatus(before.map((t) => t.id), "trash");
    queueMailAction(emailIds(before), "trash");
    notify(before.length === 1 ? "Deleted" : `Deleted ${before.length} conversations`, () => {
      restoreStatus(before);
      queueMailAction(emailIds(before), "untrash");
    });
  }, [notify, saveStatus, restoreStatus, queueMailAction]);

  const [replyTo, setReplyToState] = useState<Record<string, Message | undefined>>({});
  const replyToRef = useRef(replyTo);
  replyToRef.current = replyTo;
  const setReplyTo = useCallback((threadId: string, message: Message | null) => {
    setReplyToState((r) => ({ ...r, [threadId]: message ?? undefined }));
  }, []);

  const send = useCallback(async (threadId: string, body: string, fromAddress?: string, files: OutboxUpload[] = [], standalone = false, copies?: { to: string[]; cc: string[] }) => {
    // A reply that started as an AI draft keeps the link, so the AI can learn from what you changed.
    const draftId = standalone ? null : threadMapRef.current.get(threadId)?.draft?.id ?? null;
    const replyToId = standalone ? null : replyToRef.current[threadId]?.id ?? null;
    const sealed = await seal(FIELD.body, body).catch(() => null);
    const { data, error } = sealed === null ? { data: null, error: true } : await supabase.from("outbox")
      .insert({ thread_id: threadId, body: sealed, draft_id: draftId, from_address: fromAddress ? await sealAddress(fromAddress) : null, reply_to_message_id: replyToId, attachment_count: files.length,
        // Reply All: the worker sends to exactly these. Sealed like any address.
        ...(copies ? { to_addresses: await Promise.all(copies.to.map((a) => sealAddress(a))), cc_addresses: await Promise.all(copies.cc.map((a) => sealAddress(a))) } : {}) })
      .select("id, created_at").single();
    if (error || !data) {
      toast("Could not send. Your reply is still in the box.");
      return false;
    }
    if (!(await attachToOutbox(data.id, files))) {
      toast("Could not attach the files. Your reply is still in the box.");
      return false;
    }
    const attachments = files.length ? pendingAttachments(files) : undefined;
    if (!standalone) {
      const t = threadMapRef.current.get(threadId);
      if (t) {
        const hours = t.lastFromMe ? 0 : Math.round(Math.max(0, (Date.now() - Date.parse(t.lastMessageAt)) / 3_600_000));
        track("reply_sent", { channel: t.channel, was_needs_reply: t.needsReply, priority: t.priority, category: t.category, hours_to_reply: hours });
        const draft = t.draft;
        if (draft && draftId) {
          const asked = draftAskRef.current[threadId];
          track("draft_sent", {
            ...draftEdit(draft.body, body),
            channel: t.channel,
            tone: draft.tone,
            secs_to_send: Math.round(Math.max(0, (Date.now() - Date.parse(draft.generatedAt)) / 1000)),
            regenerated: Math.max(0, (asked ?? 1) - 1),
            auto: !!draft.auto,
          });
          delete draftAskRef.current[threadId];
        }
      }
    }
    setPending((p) => [...p, { id: data.id, threadId, body, createdAt: data.created_at, status: "queued", attachments }]);
    if (draftId) rawDispatch({ type: "setDraft", id: threadId });
    if (replyToId) setReplyTo(threadId, null);
    return true;
  }, [setReplyTo]);

  // Shown at once; the worker sends it over WhatsApp and the stored message then matches.
  const react = useCallback((message: Message, emoji: string) => {
    const reactions = { ...(message.reactions ?? {}) };
    if (emoji) reactions.me = emoji;
    else delete reactions.me;
    rawDispatch({ type: "replaceMessage", message: { ...message, reactions: Object.keys(reactions).length ? reactions : undefined } });
    supabase.from("mail_actions").insert({ thread_id: message.threadId, action: "react", message_id: message.id, emoji }).then(({ error }) => {
      if (!error) return;
      rawDispatch({ type: "replaceMessage", message });
      saveFailed();
    });
  }, [saveFailed]);

  // A new email has no conversation yet. The worker sets thread_id once the sent copy is stored.
  const composeEmail = useCallback(async (email: NewEmail) => {
    const files = email.files ?? [];
    const sealed = await Promise.all([seal(FIELD.subject, email.subject.trim() || null), seal(FIELD.body, email.body)]).catch(() => null);
    const { data, error } = sealed === null ? { data: null, error: true } : await supabase.from("outbox")
      .insert({
        account_id: email.accountId,
        from_address: email.fromAddress ? await sealAddress(email.fromAddress) : email.fromAddress,
        to_addresses: await Promise.all(email.to.map((a) => sealAddress(a))),
        cc_addresses: await Promise.all((email.cc ?? []).map((a) => sealAddress(a))),
        bcc_addresses: await Promise.all((email.bcc ?? []).map((a) => sealAddress(a))),
        subject: sealed[0],
        body: sealed[1],
        attachment_count: files.length,
        draft_id: email.draftId ?? null,
      })
      .select("id").single();
    if (error || !data) {
      toast("Could not send. Your email is still in the box.");
      return null;
    }
    if (!(await attachToOutbox(data.id, files))) {
      toast("Could not attach the files. Your email is still in the box.");
      return null;
    }
    setComposed((c) => ({ ...c, [data.id]: { status: "queued" } }));
    return data.id;
  }, []);

  // A new WhatsApp chat: one number, no subject or From address. The worker sets thread_id once it is sent.
  const composeWhatsApp = useCallback(async (accountId: string, to: string, body: string, draftId?: string) => {
    const sealed = await seal(FIELD.body, body).catch(() => null);
    const { data, error } = sealed === null ? { data: null, error: true } : await supabase.from("outbox")
      .insert({ account_id: accountId, to_addresses: [await sealAddress(to)], body: sealed, attachment_count: 0, draft_id: draftId ?? null })
      .select("id").single();
    if (error || !data) {
      toast("Could not send. Your message is still in the box.");
      return null;
    }
    setComposed((c) => ({ ...c, [data.id]: { status: "queued" } }));
    return data.id;
  }, []);

  const refreshCompose = useCallback(async (outboxId: string) => {
    const { data } = await supabase.from("outbox").select("status, thread_id, error").eq("id", outboxId).maybeSingle();
    if (data) setComposed((c) => ({ ...c, [outboxId]: composeStatusOf(data) }));
  }, []);

  const ensureThread = useCallback(async (threadId: string) => {
    if (threadMapRef.current.has(threadId)) return true;
    const loaded = await loadThread(threadId).catch(() => null);
    if (!loaded) return false;
    rawDispatch({ type: "upsertContacts", contacts: loaded.contacts });
    rawDispatch({ type: "upsertThread", thread: loaded.thread });
    return true;
  }, []);

  // Only send_addresses is writable by the app; the database lowercases and dedupes the list.
  const saveSendAddresses = useCallback(async (accountId: string, addresses: string[]) => {
    const before = stateRef.current.accounts.find((a) => a.id === accountId)?.sendAddresses ?? [];
    rawDispatch({ type: "patchAccount", id: accountId, patch: { sendAddresses: addresses } });
    const unique = [...new Set(addresses.map((a) => a.trim().toLowerCase()).filter(Boolean))];
    const { error } = await supabase.from("accounts").update({ send_addresses: await Promise.all(unique.map((a) => sealAddress(a))) }).eq("id", accountId);
    if (error) {
      rawDispatch({ type: "patchAccount", id: accountId, patch: { sendAddresses: before } });
      saveFailed();
      return false;
    }
    return true;
  }, [saveFailed]);

  // The AI worker writes the draft; it arrives through Realtime, usually within a few seconds. One that
  // has not arrived after DRAFT_TIMEOUT_MS is given up on, so the composer never waits forever.
  const generateDraft = useCallback(async (threadId: string, tone: Draft["tone"] = "default", instruction?: string, decision?: Decision, source?: string, audio?: Blob) => {
    if (!userId) return;
    const asking = threadMapRef.current.get(threadId);
    draftAskRef.current[threadId] = (draftAskRef.current[threadId] ?? 0) + 1;
    if (asking) track("draft_requested", { tone, source: decision ? "choice" : "manual", channel: asking.channel, has_instruction: !!instruction?.trim() || !!audio, revises: source !== undefined, via: audio ? "voice" : instruction?.trim() ? "typed" : undefined });
    setDrafting((d) => ({ ...d, [threadId]: "thinking" }));
    // A recording goes up sealed with your key first; the worker deletes it once the draft is written.
    const audioPath = audio ? await uploadRecording(userId, audio) : undefined;
    if (audio && !audioPath) {
      setDrafting((d) => ({ ...d, [threadId]: undefined }));
      toast("Could not send the recording. Check your connection and try again.");
      return;
    }
    const { data, error } = await supabase
      .from("drafts")
      .insert({
        user_id: userId, thread_id: threadId, tone, instruction: await seal(FIELD.instruction, instruction?.trim() || null), status: "pending",
        // Only sent with a choice, so drafts keep working where the decision columns are not there yet.
        ...(decision ? { decision: await seal(FIELD.instruction, decision.text), decision_kind: decision.kind } : {}),
        ...(source !== undefined ? { source: await seal(FIELD.draft, source) } : {}),
        ...(audioPath ? { audio_path: audioPath } : {}),
      })
      .select("id")
      .single();
    if (error || !data) {
      if (audioPath) void supabase.storage.from("attachments").remove([audioPath]).then(() => undefined);
      setDrafting((d) => ({ ...d, [threadId]: undefined }));
      toast(tone === "edit" ? "Could not ask for an edit. Check your connection and try again." : "Could not ask for a draft. Check your connection and try again.");
      return;
    }
    draftWaitRef.current[threadId] = data.id;
    setTimeout(() => {
      if (draftWaitRef.current[threadId] !== data.id) return;
      delete draftWaitRef.current[threadId];
      setDrafting((d) => ({ ...d, [threadId]: undefined }));
      toast(tone === "edit" ? "The edit took too long. Try again." : "The draft took too long. Try again.");
      // Withdrawn, so the AI worker does not pick it up later. A Supabase query only runs once awaited.
      void supabase.from("drafts").update({ status: "discarded" }).eq("id", data.id).eq("status", "pending").then(() => undefined);
      if (audioPath) void supabase.storage.from("attachments").remove([audioPath]).then(() => undefined);
    }, audio ? VOICE_DRAFT_TIMEOUT_MS : DRAFT_TIMEOUT_MS);
  }, [userId]);

  // A new message's draft: the same pending row and AI worker, with no conversation. It comes back
  // through Realtime into composeDrafts; one not back after the timeout is given up on and withdrawn.
  const generateComposeDraft = useCallback(async (req: ComposeDraftRequest) => {
    if (!userId) return null;
    const tone = req.tone ?? "custom";
    const instruction = req.instruction?.trim() || undefined;
    track("draft_requested", { tone, source: "compose", channel: req.channel, has_instruction: !!instruction || !!req.audio, revises: req.source !== undefined, via: req.audio ? "voice" : instruction ? "typed" : undefined });
    const audioPath = req.audio ? await uploadRecording(userId, req.audio) : undefined;
    if (req.audio && !audioPath) {
      toast("Could not send the recording. Check your connection and try again.");
      return null;
    }
    const { data, error } = await supabase
      .from("drafts")
      .insert({
        user_id: userId, thread_id: null, account_id: req.accountId, contact_id: req.contactId ?? null, tone, status: "pending",
        instruction: await seal(FIELD.instruction, instruction ?? null),
        ...(req.source !== undefined ? { source: await seal(FIELD.draft, req.source) } : {}),
        ...(audioPath ? { audio_path: audioPath } : {}),
      })
      .select("id")
      .single();
    if (error || !data) {
      if (audioPath) void supabase.storage.from("attachments").remove([audioPath]).then(() => undefined);
      toast("Could not ask for a draft. Check your connection and try again.");
      return null;
    }
    composeWaitRef.current.add(data.id);
    setComposeDrafts((c) => ({ ...c, [data.id]: { status: "pending" } }));
    setTimeout(() => {
      if (!composeWaitRef.current.delete(data.id)) return;
      setComposeDrafts((c) => ({ ...c, [data.id]: { status: "failed", error: "The draft took too long. Try again." } }));
      void supabase.from("drafts").update({ status: "discarded" }).eq("id", data.id).eq("status", "pending").then(() => undefined);
      if (audioPath) void supabase.storage.from("attachments").remove([audioPath]).then(() => undefined);
    }, req.audio ? VOICE_DRAFT_TIMEOUT_MS : DRAFT_TIMEOUT_MS);
    return data.id;
  }, [userId]);

  const discardComposeDraft = useCallback((id: string, status: "discarded" | "revised" = "discarded") => {
    composeWaitRef.current.delete(id);
    setComposeDrafts((c) => { const next = { ...c }; delete next[id]; return next; });
    void supabase.from("drafts").update({ status }).eq("id", id).in("status", ["pending", "active"]).then(() => undefined);
  }, []);

  const discardDraft = useCallback((threadId: string) => {
    const t = threadMapRef.current.get(threadId);
    const draft = t?.draft;
    if (t && draft) track("draft_discarded", { channel: t.channel, tone: draft.tone, secs: Math.round(Math.max(0, (Date.now() - Date.parse(draft.generatedAt)) / 1000)), auto: !!draft.auto });
    rawDispatch({ type: "setDraft", id: threadId });
    if (draft) supabase.from("drafts").update({ status: "discarded" }).eq("id", draft.id).then(({ error }) => { if (error) saveFailed(); });
  }, [saveFailed]);

  // Junk you choose yourself also goes to the provider's spam; junk the AI sorts out stays where it is there.
  const setJunk = useCallback((threadIds: string | string[], junk: boolean) => {
    if (!userId) return;
    const before = threadsIn(stateRef.current.threads, threadIds).filter((t) => t.junk !== junk);
    if (before.length === 0) return;
    const ids = before.map((t) => t.id);
    recordAction(before, junk ? "junk" : "not_junk");
    for (const t of before.slice(0, 3)) recordCorrection(t.id, "junk", t.junk ? "junk" : "not_junk", junk ? "junk" : "not_junk");
    const feedbackIds = ids.map(() => crypto.randomUUID());
    const save = (value: boolean) => {
      rawDispatch({ type: "patchThreads", ids, patch: { junk: value } });
      return supabase.from("threads").update({ junk: value }).in("id", ids);
    };
    Promise.all([
      save(junk),
      supabase.from("feedback").insert(ids.map((thread_id, i) => ({ id: feedbackIds[i], user_id: userId, thread_id, value: junk ? "junk" : "not_junk" }))),
    ]).then((results) => { if (results.some((r) => r.error)) saveFailed(); });
    queueMailAction(emailIds(before), junk ? "spam" : "unspam");
    const n = before.length;
    const text = junk ? (n === 1 ? "Moved to Junk" : `Moved ${n} conversations to Junk`) : n === 1 ? "Moved out of Junk" : `Moved ${n} conversations out of Junk`;
    notify(text, () => {
      // The correction is taken back too, so the AI does not learn from it.
      Promise.all([save(!junk), supabase.from("feedback").delete().in("id", feedbackIds)])
        .then((results) => { if (results.some((r) => r.error)) saveFailed(); });
      queueMailAction(emailIds(before), junk ? "unspam" : "spam");
    });
  }, [userId, notify, saveFailed, queueMailAction]);

  const unsubscribe = useCallback(async (senders: { accountId: string; sender: string }[]) => {
    const existing = new Map(stateRef.current.unsubscribes.map((u) => [`${u.accountId}|${u.sender}`, u]));
    // Senders are queued at once rather than one after another. Returns true when the sender is queued.
    const queueOne = async (s: { accountId: string; sender: string }) => {
      const previous = existing.get(`${s.accountId}|${s.sender}`);
      if (previous && previous.status !== "failed" && previous.status !== "manual") return true; // already on its way
      if (previous) {
        // A failed or manual attempt is cleared first so the sender can be tried again.
        await supabase.from("unsubscribes").delete().eq("id", previous.id);
        rawDispatch({ type: "removeUnsubscribe", id: previous.id });
      }
      // With the sender's index, which the database matches on (and which keeps a sender to one row).
      const stored = { sender_address: await sealAddress(s.sender), sender_index: await addressIndex(await userKeys(), s.sender) };
      const { data, error } = await supabase.from("unsubscribes").insert({ account_id: s.accountId, ...stored }).select(UNSUBSCRIBE_COLUMNS).single();
      if (error || !data) return false;
      rawDispatch({ type: "upsertUnsubscribe", unsubscribe: { ...mapUnsubscribe(data), sender: s.sender } });
      return true;
    };
    const results = await Promise.all(senders.map(queueOne));
    const queued = results.filter(Boolean).length;
    if (queued < senders.length) toast("Some senders could not be queued. Try again.");
    return queued;
  }, []);

  // "I've Unsubscribed" is easy to press by mistake, so it shows at once but is only saved once this long has
  // passed without Undo. Closing the page in that time saves nothing, and the sender stays to do.
  const CONFIRM_UNSUBSCRIBE_MS = 6000;
  const confirmUnsubscribe = useCallback((id: string) => {
    const before = stateRef.current.unsubscribes.find((u) => u.id === id);
    if (!before || before.status !== "manual") return;
    rawDispatch({ type: "upsertUnsubscribe", unsubscribe: { ...before, status: "done" } });
    const timer = setTimeout(() => {
      void supabase.rpc("confirm_unsubscribe", { p_id: id }).then(({ error }) => {
        if (!error) return;
        rawDispatch({ type: "upsertUnsubscribe", unsubscribe: before });
        toast("Could not mark it as unsubscribed. Try again.");
      });
    }, CONFIRM_UNSUBSCRIBE_MS);
    toast("Marked as unsubscribed", {
      duration: CONFIRM_UNSUBSCRIBE_MS,
      action: { label: "Undo", onClick: () => { clearTimeout(timer); rawDispatch({ type: "upsertUnsubscribe", unsubscribe: before }); } },
    });
  }, []);

  const giveFeedback = useCallback((id: string, value: "important" | "not_important") => {
    if (!userId) return;
    const priority = value === "important" ? "important" : "low";
    const before = threadMapRef.current.get(id);
    if (before) recordCorrection(id, "priority", before.priority, priority);
    rawDispatch({ type: "feedback", id, value });
    Promise.all([
      supabase.from("feedback").insert({ user_id: userId, thread_id: id, value }),
      supabase.from("threads").update({ priority }).eq("id", id),
    ]).then((results) => { if (results.some((r) => r.error)) saveFailed(); });
    notify(value === "important" ? "Marked as important" : "Marked as not important");
  }, [userId, notify, saveFailed]);

  // After a merge, split or undo: every contact and conversation member again, and the open
  // conversations whose senders or members changed.
  const refreshContacts = useCallback(async (affected: string[]) => {
    // The change is already saved, so the Contacts lists reload straight away.
    setContactsVersion((v) => v + 1);
    let contacts: Contact[] = stateRef.current.contacts;
    try {
      const graph = await loadContactGraph();
      contacts = graph.contacts;
      const ids = new Set(affected);
      const threadIds = new Set<string>();
      for (const [threadId, list] of Object.entries(stateRef.current.byThread)) if (loadedRef.current.has(threadId) && list.some((m) => ids.has(m.from))) threadIds.add(threadId);
      for (const [threadId, members] of graph.participants) if (loadedRef.current.has(threadId) && members.some((id) => ids.has(id))) threadIds.add(threadId);
      rawDispatch({ type: "setContactGraph", contacts: graph.contacts, participants: graph.participants });
      // Everything already loaded is fetched again for its new senders, keeping older pages and jumps.
      await Promise.all([...threadIds].map(async (threadId) => {
        const oldest = stateRef.current.byThread[threadId]?.[0];
        if (!oldest) return;
        const page = await loadThreadMessages(threadId, { from: oldest.sentAt });
        rawDispatch({ type: "mergeMessages", threadId, messages: page.messages });
      }));
    } catch {
      toast("Could not refresh your contacts. Reload to see the change.");
    }
    return contacts;
  }, []);

  const undoMerge = useCallback(async (mergeId: string) => {
    const { error, keptId, mergedId } = await undoMergeRpc(mergeId);
    if (error) {
      toast(mergeErrorText(error, "Could not undo the merge. Check your connection and try again."));
      return false;
    }
    if (mergedId) setMergedInto((m) => ({ ...m, [mergedId]: undefined }));
    await refreshContacts([keptId, mergedId].filter((id): id is string => !!id));
    toast("Merge undone");
    return true;
  }, [refreshContacts]);

  const mergeContacts = useCallback(async (keepId: string, mergeId: string, reason: "suggestion" | "manual", name?: string) => {
    const { data, error } = await mergeContactsRpc(keepId, mergeId, reason);
    if (error || !data) {
      toast(mergeErrorText(error, "Could not merge these contacts. Check your connection and try again."));
      return null;
    }
    track("feature_used", { feature: "merge_contacts", detail: reason });
    if (name) await keepName(keepId, name).catch(() => { toast("Merged, but could not keep the name you chose."); });
    setMergedInto((m) => ({ ...m, [mergeId]: keepId }));
    const contacts = await refreshContacts([keepId, mergeId]);
    const kept = contacts.find((c) => c.id === keepId)?.name ?? name;
    notify(kept ? `Merged into ${kept}` : "Merged", () => { void undoMerge(data); });
    return data;
  }, [refreshContacts, notify, undoMerge]);

  const splitContact = useCallback(async (contactId: string, identityIds: string[], name: string) => {
    const { data, error } = await splitContactRpc(contactId, identityIds, name);
    if (error || !data) {
      toast(mergeErrorText(error, "Could not split this contact. Check your connection and try again."));
      return null;
    }
    track("feature_used", { feature: "split_contact" });
    await refreshContacts([contactId, data]);
    return data;
  }, [refreshContacts]);

  // Ticks waiting on the worker, by task, laid over the tasks until each settles.
  const [ticks, setTicks] = useState<Record<string, PendingTick | undefined>>({});
  const ticksRef = useRef(ticks);
  ticksRef.current = ticks;
  const tasks = useMemo(() => withTicks(state.tasks, ticks), [state.tasks, ticks]);
  useEffect(() => { setTicks({}); }, [userId]);

  const tickTask = useCallback((task: Task, done: boolean, via: "calendar" | "details" | "summary") => {
    if (!userId) return;
    const action = done ? "complete" : "reopen";
    const provider = stateRef.current.accounts.find((a) => a.id === task.accountId)?.provider ?? "unknown";
    track("task_ticked", { action, provider, overdue: isOverdue(task), timed: !!task.dueAt && !task.dueAllDay, via });
    const temp = `tick-${crypto.randomUUID()}`;
    setTicks((t) => ({ ...t, [task.id]: { token: temp, done } }));
    // A tick is dropped by its own result only while it is the latest for its task, so an earlier one settling leaves the newer showing.
    const drop = (token: string) => setTicks((t) => (t[task.id]?.token === token ? { ...t, [task.id]: undefined } : t));
    void (async () => {
      const { data, error } = await supabase.from("task_updates").insert({ task_id: task.id, action }).select("id").single();
      if (error || !data) {
        drop(temp);
        saveFailed();
        return;
      }
      setTicks((t) => (t[task.id]?.token === temp ? { ...t, [task.id]: { token: data.id, done } } : t));
      const result = await followTaskUpdate(data.id);
      // The task as the worker left it, in case its own Realtime update is slow or missed.
      if (result.status === "done" && ticksRef.current[task.id]?.token === data.id) {
        rawDispatch({ type: "patchTask", id: task.id, patch: { completed: done, completedAt: done ? new Date().toISOString() : undefined } });
      }
      if (result.status === "failed") toast(result.error ?? (done ? "The task could not be ticked off." : "The task could not be reopened."));
      drop(data.id);
    })();
  }, [userId, saveFailed]);

  // Tasks made, changed and deleted here go through the same queue as a tick. Title and notes are sealed before the row is stored.
  const queueTaskWrite = useCallback(async (row: { action: "create" | "update" | "delete"; task_id?: string; account_id?: string }, write?: ReturnType<typeof taskWriteFields>) => {
    const sealed = write ? await Promise.all([seal(FIELD.taskTitle, write.title), seal(FIELD.taskNotes, write.notes)]).catch(() => null) : undefined;
    if (write && !sealed) return null;
    const { data, error } = await supabase
      .from("task_updates")
      .insert({ ...row, ...(write && sealed ? { title: sealed[0], notes: sealed[1], due_at: write.due_at, due_all_day: write.due_all_day, priority: write.priority } : {}) })
      .select("id")
      .single();
    return error || !data ? null : data.id;
  }, []);

  const createTask = useCallback((form: TaskForm) => {
    if (!userId) return;
    const provider = stateRef.current.accounts.find((a) => a.id === form.accountId)?.provider;
    const write = taskWriteFields(form, provider);
    const temp = tempTaskId();
    rawDispatch({ type: "upsertTask", task: taskOfWrite(temp, form.accountId, write) });
    void (async () => {
      const id = await queueTaskWrite({ action: "create", account_id: form.accountId }, write);
      if (!id) {
        rawDispatch({ type: "removeTask", id: temp });
        saveFailed();
        return;
      }
      const result = await followTaskUpdate(id, 60_000, 2000, "Creating the task is taking too long. Check that the worker is running.");
      // The worker has stored the real task by now (its Realtime insert replaces this one); on failure it never will.
      rawDispatch({ type: "removeTask", id: temp });
      toast(result.status === "failed" ? (result.error ?? "The task could not be created.") : "Task created.");
    })();
  }, [userId, saveFailed, queueTaskWrite]);

  const editTask = useCallback((task: Task, form: TaskForm) => {
    if (!userId || isTempTask(task)) return;
    const provider = stateRef.current.accounts.find((a) => a.id === task.accountId)?.provider;
    const write = taskWriteFields({ ...form, accountId: task.accountId }, provider);
    rawDispatch({ type: "upsertTask", task: taskOfWrite(task.id, task.accountId, write, task) });
    // Put back as it was, unless something newer has been shown for the task since.
    const restore = () => rawDispatch({ type: "upsertTask", task });
    void (async () => {
      const id = await queueTaskWrite({ action: "update", task_id: task.id }, write);
      if (!id) {
        restore();
        saveFailed();
        return;
      }
      const result = await followTaskUpdate(id, 60_000, 2000, "Saving the task is taking too long. Check that the worker is running.");
      if (result.status === "failed") {
        restore();
        toast(result.error ?? "The task could not be changed.");
        return;
      }
      rawDispatch({ type: "patchTask", id: task.id, patch: { pending: false } });
    })();
  }, [userId, saveFailed, queueTaskWrite]);

  const deleteTask = useCallback((task: Task) => {
    if (!userId || isTempTask(task)) return;
    rawDispatch({ type: "removeTask", id: task.id });
    void (async () => {
      const id = await queueTaskWrite({ action: "delete", task_id: task.id });
      if (!id) {
        rawDispatch({ type: "upsertTask", task });
        saveFailed();
        return;
      }
      const result = await followTaskUpdate(id, 60_000, 2000, "Deleting the task is taking too long. Check that the worker is running.");
      if (result.status === "failed") {
        rawDispatch({ type: "upsertTask", task });
        toast(result.error ?? "The task could not be deleted.");
        return;
      }
      toast("Task deleted.");
    })();
  }, [userId, saveFailed, queueTaskWrite]);

  // One value per change, so components that read the store redraw only when something changed.
  const value = useMemo<Ctx>(() => ({
    ...listState(state), dispatch, contactById, threadById, messages, messagesByThread, messagesFor, messagesLoaded, loadMessages, loadOlderMessages, prefetchMessages,
    listThreads, notify, markRead, archive, trash, pin, send, replyTo, setReplyTo, react, composeEmail, composeWhatsApp, composed, refreshCompose, ensureThread,
    saveSendAddresses, generateDraft, discardDraft, requestAutoDraft, generateComposeDraft, composeDrafts, discardComposeDraft, setJunk, unsubscribe, confirmUnsubscribe, drafting, hydrated, giveFeedback, mergeContacts, splitContact, undoMerge, refreshContacts,
    contactsVersion, tasks, tickTask, createTask, editTask, deleteTask,
  }), [
    state, dispatch, contactById, threadById, messages, messagesByThread, messagesFor, messagesLoaded, loadMessages, loadOlderMessages, prefetchMessages,
    listThreads, notify, markRead, archive, trash, pin, send, replyTo, setReplyTo, react, composeEmail, composeWhatsApp, composed, refreshCompose, ensureThread,
    saveSendAddresses, generateDraft, discardDraft, requestAutoDraft, generateComposeDraft, composeDrafts, discardComposeDraft, setJunk, unsubscribe, confirmUnsubscribe, drafting, hydrated, giveFeedback, mergeContacts, splitContact, undoMerge, refreshContacts,
    contactsVersion, tasks, tickTask, createTask, editTask, deleteTask,
  ]);
  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useApp() {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error("useApp outside provider");
  return ctx;
}
