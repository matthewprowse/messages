import type { Tables } from "@messages/db";
import { openAddresses, openDrafts, openMessages, openThreads } from "./open-rows";
import { supabase } from "./supabase";
import type { Account, AccountStatus, Attachment, Category, Contact, Draft, FiledAttachment, Message, Priority, Profile, Provider, Rule, Thread, Unsubscribe, WritingExample } from "./types";
import { formatSize } from "./format";
import { emailParts, emphasisRuns, type Emphasis } from "./email-text";
import type { ChoiceKind } from "./choices";
import { allRows } from "./contacts";
import { formatPhone } from "./format";

// Turns database rows into the shapes the screens use, and loads them for the signed-in user.
// Row-level security means every query here only ever returns that user's own rows.

type ContactRow = Pick<Tables<"contacts">, "id" | "display_name" | "company" | "role" | "avatar_path">;
type IdentityRow = Pick<Tables<"contact_identities">, "kind" | "value">;
type ThreadRow = Pick<
  Tables<"threads">,
  | "id" | "account_id" | "channel" | "subject" | "is_group" | "group_name" | "avatar_path" | "provider_thread_id" | "last_message_at"
  | "created_at" | "last_message_preview" | "junk" | "subscription" | "last_sender_contact_id" | "unread_count" | "pinned" | "status" | "priority" | "category" | "summary" | "needs_reply"
>;
type AttachmentRow = Pick<Tables<"attachments">, "id" | "message_id" | "filename" | "kind" | "size_bytes" | "storage_path" | "hidden">;
export type MessageRow = Pick<
  Tables<"messages">,
  "id" | "provider_message_id" | "thread_id" | "direction" | "sender_contact_id" | "sender_address" | "to_addresses" | "sent_at" | "subject" | "body_text" | "body_html" | "provider_meta" | "has_original" | "is_bulk" | "body_marks"
> & { attachments: AttachmentRow[] };

const CONTACT_COLUMNS = "id, display_name, company, role, avatar_path";
const THREAD_COLUMNS =
  "id, account_id, channel, subject, is_group, group_name, avatar_path, provider_thread_id, last_message_at, created_at, last_message_preview, junk, subscription, last_sender_contact_id, unread_count, pinned, status, priority, category, summary, needs_reply";
// Threads with their account's provider and their people, so the list can draw names in one request.
const THREAD_WITH_PEOPLE = `${THREAD_COLUMNS}, accounts(provider), thread_participants(contact_id, contacts(${CONTACT_COLUMNS}, contact_identities(kind, value)))` as const;
const ATTACHMENT_COLUMNS = "id, message_id, filename, kind, size_bytes, storage_path, hidden";
// Named columns, never select("*"). body_html is only still set on emails stored before the HTML stopped
// being kept (View Original now fetches it); is_bulk and has_original carry what it was needed for.
const MESSAGE_COLUMNS = `id, provider_message_id, thread_id, direction, sender_contact_id, sender_address, to_addresses, sent_at, subject, body_text, body_html, provider_meta, has_original, is_bulk, body_marks, attachments(${ATTACHMENT_COLUMNS})` as const;

/** How many messages a conversation opens with, and how many more each scroll up loads. */
export const MESSAGE_PAGE = 200;

export const EMPTY_PROFILE: Profile = {
  name: "",
  about: "",
  people: "",
  quietStart: "22:00",
  quietEnd: "07:30",
  pushUrgent: true,
  pushImportant: true,
  autoDraftTop: true,
  whatsappReadReceipts: true,
};

function initialsOf(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] ?? "") + (parts.length > 1 ? parts[parts.length - 1][0] : "")).toUpperCase() || "?";
}

export function mapContact(row: ContactRow, identities: IdentityRow[]): Contact {
  return {
    id: row.id,
    name: row.display_name,
    initials: initialsOf(row.display_name),
    hue: 0,
    emails: identities.filter((i) => i.kind === "email").map((i) => i.value),
    // WhatsApp privacy IDs ("...@lid") stand in for a hidden number: they are not phone numbers.
    phones: identities.filter((i) => i.kind !== "email" && !i.value.includes("@")).map((i) => i.value),
    company: row.company ?? undefined,
    role: row.role ?? undefined,
    avatarPath: row.avatar_path ?? undefined,
  };
}

/** A WhatsApp chat's own name when no person is stored for it: its number, or WhatsApp for its own account. */
function whatsappChatName(chatId: string): string | undefined {
  const user = chatId.split("@")[0];
  if (!/^\d+$/.test(user)) return undefined;
  return user.length < 6 ? "WhatsApp" : formatPhone(`+${user}`);
}

export function mapThread(row: ThreadRow, participantIds: string[], provider: Provider): Thread {
  // The conversation is shown as its first participant, so whoever sent the latest message leads. An email
  // can have several people in it, such as a forward from one that copies in another.
  const lead = row.last_sender_contact_id;
  if (lead && participantIds[0] !== lead && participantIds.includes(lead)) participantIds = [lead, ...participantIds.filter((id) => id !== lead)];
  return {
    id: row.id,
    accountId: row.account_id,
    channel: row.channel as Thread["channel"],
    provider,
    subject: row.subject ?? undefined,
    participantIds,
    isGroup: row.is_group,
    groupName: row.group_name ?? undefined,
    avatarPath: row.avatar_path ?? undefined,
    fallbackName: row.channel === "whatsapp" && !row.is_group ? whatsappChatName(row.provider_thread_id) : undefined,
    lastMessageAt: row.last_message_at ?? row.created_at,
    preview: row.last_message_preview ?? undefined,
    junk: row.junk,
    subscription: row.subscription,
    unread: row.unread_count > 0,
    unreadCount: row.unread_count,
    pinned: row.pinned,
    status: row.status as Thread["status"],
    // AI triage is not running yet, so untriaged conversations are treated as normal.
    priority: (row.priority as Priority | null) ?? "normal",
    category: (row.category as Category | null) ?? "fyi",
    summary: row.summary ?? "",
    needsReply: row.needs_reply,
  };
}

type ThreadWithPeople = ThreadRow & {
  accounts: { provider: string } | null;
  thread_participants: { contact_id: string; contacts: (ContactRow & { contact_identities: IdentityRow[] }) | null }[];
};

/** A thread row with its people embedded, and those people as contacts. */
function threadWithPeople(row: ThreadWithPeople, contacts: Map<string, Contact>): Thread {
  for (const p of row.thread_participants) {
    if (p.contacts && !contacts.has(p.contact_id)) contacts.set(p.contact_id, mapContact(p.contacts, p.contacts.contact_identities));
  }
  return mapThread(row, row.thread_participants.map((p) => p.contact_id), (row.accounts?.provider as Provider | undefined) ?? "icloud");
}

/** What a WhatsApp message carries in provider_meta besides where it lives: its quote, reactions and state. */
export function whatsappExtras(meta: unknown): Pick<Message, "quote" | "reactions" | "deleted" | "edited"> {
  const m = (meta ?? {}) as {
    quoted?: { id?: string; author?: string; from_me?: boolean; text?: string };
    reactions?: Record<string, string>;
    deleted?: boolean;
    edited?: boolean;
  };
  const q = m.quoted;
  return {
    quote: q?.id && q.text ? { id: q.id, author: q.author || "Unknown", fromMe: !!q.from_me, text: q.text } : undefined,
    reactions: m.reactions && Object.keys(m.reactions).length ? m.reactions : undefined,
    deleted: m.deleted || undefined,
    edited: m.edited || undefined,
  };
}

export function mapAttachment(a: Omit<AttachmentRow, "message_id" | "hidden">): Attachment {
  return { id: a.id, name: a.filename, kind: a.kind as Attachment["kind"], size: formatSize(a.size_bytes), path: a.storage_path ?? undefined };
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
    whatsapp: whatsapp || undefined,
    hasOriginal: row.has_original,
    attachments: files.length ? files : undefined,
  };
}

/**
 * A stored message after a Realtime UPDATE: its reactions, quote, edit or deletion, and a chat message's
 * new text. Email bodies never change and may be missing from the payload, so they are left alone.
 * Returns the same object when nothing shown has changed, such as when only is_read did.
 */
export function patchMessage(m: Message, row: { provider_meta?: unknown; body_text?: string | null }): Message {
  const next: Message = row.provider_meta === undefined ? { ...m } : { ...m, ...whatsappExtras(row.provider_meta) };
  if (m.whatsapp && typeof row.body_text === "string") next.body = row.body_text;
  else if (!m.hasOriginal && typeof row.body_text === "string") {
    const parts = emailParts(row.body_text, null);
    next.body = parts.body;
    next.quoted = parts.quoted;
  }
  const shown = (x: Message) => JSON.stringify([x.body, x.quoted, x.quote, x.reactions, x.deleted, x.edited]);
  return shown(next) === shown(m) ? m : next;
}

export function mapAccount(row: Tables<"accounts">): Account {
  return {
    id: row.id,
    provider: row.provider as Provider,
    label: row.label,
    detail: row.address,
    status: row.status as AccountStatus,
    statusDetail: row.status_detail ?? undefined,
    lastSync: row.last_synced_at ?? undefined,
    sendAddresses: row.send_addresses ?? [],
  };
}

function mapProfile(row: Tables<"profiles"> | null): Profile {
  if (!row) return EMPTY_PROFILE;
  return {
    name: row.display_name ?? "",
    about: row.about ?? "",
    people: row.important_people ?? "",
    quietStart: row.quiet_start.slice(0, 5),
    quietEnd: row.quiet_end.slice(0, 5),
    pushUrgent: row.push_urgent,
    pushImportant: row.push_important,
    autoDraftTop: row.auto_draft_top,
    whatsappReadReceipts: row.whatsapp_read_receipts,
  };
}

/** Profile fields as database columns, for saving a partial change. */
export function profilePatch(patch: Partial<Profile>) {
  const out: Partial<Tables<"profiles">> = {};
  if (patch.name !== undefined) out.display_name = patch.name;
  if (patch.about !== undefined) out.about = patch.about;
  if (patch.people !== undefined) out.important_people = patch.people;
  if (patch.quietStart !== undefined) out.quiet_start = patch.quietStart;
  if (patch.quietEnd !== undefined) out.quiet_end = patch.quietEnd;
  if (patch.pushUrgent !== undefined) out.push_urgent = patch.pushUrgent;
  if (patch.pushImportant !== undefined) out.push_important = patch.pushImportant;
  if (patch.autoDraftTop !== undefined) out.auto_draft_top = patch.autoDraftTop;
  if (patch.whatsappReadReceipts !== undefined) out.whatsapp_read_receipts = patch.whatsappReadReceipts;
  return out;
}

export function mapDraft(row: Tables<"drafts">): Draft {
  return {
    id: row.id,
    body: row.body,
    tone: row.tone as Draft["tone"],
    instruction: row.instruction ?? undefined,
    decision: row.decision && row.decision_kind ? { text: row.decision, kind: row.decision_kind as ChoiceKind } : undefined,
    generatedAt: row.updated_at,
  };
}

export function mapUnsubscribe(row: Tables<"unsubscribes">): Unsubscribe {
  return {
    id: row.id,
    accountId: row.account_id,
    sender: row.sender_address,
    status: row.status as Unsubscribe["status"],
    manualUrl: row.manual_url ?? undefined,
    error: row.error ?? undefined,
  };
}

export interface Loaded {
  threads: Thread[];
  /** Only the people in those threads. Everyone else loads after the list is drawn (see loadContacts). */
  contacts: Contact[];
  accounts: Account[];
  rules: Rule[];
  writingExamples: WritingExample[];
  profile: Profile;
  unsubscribes: Unsubscribe[];
}

const THREAD_LIMIT = 1000;


/** Everything the list screens need, in parallel. Messages load per conversation when it is opened. */
export async function loadEverything(): Promise<Loaded> {
  const [threads, accounts, profile, rules, examples, drafts, unsubscribes] = await Promise.all([
    // Deleted conversations (in the provider's bin) are never shown, so they are not loaded.
    supabase.from("threads").select(THREAD_WITH_PEOPLE).neq("status", "trash")
      .order("last_message_at", { ascending: false, nullsFirst: false }).limit(THREAD_LIMIT),
    supabase.from("accounts").select("*"),
    supabase.from("profiles").select("*").maybeSingle(),
    supabase.from("priority_rules").select("id, kind, target").order("created_at", { ascending: false }),
    supabase.from("writing_examples").select("id, situation, body").order("created_at", { ascending: false }),
    supabase.from("drafts").select("*").eq("status", "active"),
    supabase.from("unsubscribes").select("*"),
  ]);
  const failed = [threads, accounts, profile, rules, examples, drafts, unsubscribes].find((r) => r.error);
  if (failed?.error) throw failed.error;
  await Promise.all([
    openThreads(threads.data ?? []),
    openDrafts(drafts.data ?? []),
    openAddresses([accounts.data ?? [], rules.data ?? [], unsubscribes.data ?? []]),
  ]);

  const draftOf = new Map((drafts.data ?? []).map((d) => [d.thread_id, mapDraft(d)]));
  const contacts = new Map<string, Contact>();
  return {
    threads: (threads.data ?? []).map((t) => ({ ...threadWithPeople(t, contacts), draft: draftOf.get(t.id) })),
    contacts: [...contacts.values()],
    accounts: (accounts.data ?? []).map(mapAccount),
    rules: (rules.data ?? []).map((r) => ({ id: r.id, kind: r.kind as Rule["kind"], target: r.target })),
    writingExamples: (examples.data ?? []).map((w) => ({ id: w.id, context: w.situation, text: w.body })),
    profile: mapProfile(profile.data),
    unsubscribes: (unsubscribes.data ?? []).map(mapUnsubscribe),
  };
}

/** Every contact with their addresses and numbers. Throws when a page fails. */
export async function loadContacts(): Promise<Contact[]> {
  const [contacts, identities] = await Promise.all([
    allRows("Load contacts", (from, to) => supabase.from("contacts").select(CONTACT_COLUMNS).order("id").range(from, to)),
    allRows("Load contacts", (from, to) => supabase.from("contact_identities").select("id, contact_id, kind, value").order("id").range(from, to)),
  ]);
  await openAddresses(identities);
  const identitiesOf = new Map<string, IdentityRow[]>();
  for (const i of identities) {
    const list = identitiesOf.get(i.contact_id);
    if (list) list.push(i);
    else identitiesOf.set(i.contact_id, [i]);
  }
  return contacts.map((c) => mapContact(c, identitiesOf.get(c.id) ?? []));
}

/** One conversation with its people, for one that has only just been created. */
export async function loadThread(threadId: string): Promise<{ thread: Thread; contacts: Contact[] } | null> {
  const { data, error } = await supabase.from("threads").select(THREAD_WITH_PEOPLE).eq("id", threadId).maybeSingle();
  if (error) throw error;
  if (!data) return null;
  await openThreads([data]);
  const contacts = new Map<string, Contact>();
  const thread = threadWithPeople(data, contacts);
  return { thread, contacts: [...contacts.values()] };
}

export interface MessagePage {
  messages: Message[];
  /** Whether older messages may be left to load. */
  more: boolean;
}

/**
 * A conversation's messages, oldest first. By default the newest page; with before, the page older than
 * that message; with from, every message from that time on, for jumping to an older message.
 */
export async function loadThreadMessages(threadId: string, at: { before?: Pick<Message, "id" | "sentAt">; from?: string } = {}): Promise<MessagePage> {
  if (at.from) {
    // Pages back from the newest until the target time, so the result always reaches the target with no gap.
    const out: Message[] = [];
    let before = at.before;
    for (;;) {
      const page = await messagePage(threadId, before, at.from, 1000);
      out.push(...page);
      if (page.length < 1000) break;
      before = page[page.length - 1];
    }
    return { messages: out.reverse(), more: true };
  }
  const page = await messagePage(threadId, at.before, undefined, MESSAGE_PAGE);
  return { messages: page.reverse(), more: page.length === MESSAGE_PAGE };
}

/** Up to limit messages older than before (if given) and no older than from (if given), newest first. */
async function messagePage(threadId: string, before: Pick<Message, "id" | "sentAt"> | undefined, from: string | undefined, limit: number): Promise<Message[]> {
  let query = supabase.from("messages").select(MESSAGE_COLUMNS).eq("thread_id", threadId);
  // Keyset paging on (sent_at, id), so messages sent in the same second are neither missed nor repeated.
  if (before) query = query.or(`sent_at.lt."${before.sentAt}",and(sent_at.eq."${before.sentAt}",id.lt.${before.id})`);
  if (from) query = query.gte("sent_at", from);
  const { data, error } = await query.order("sent_at", { ascending: false }).order("id", { ascending: false }).limit(limit);
  if (error) throw error;
  return (await openMessages(data)).map(mapMessage);
}

/** When a message was sent, if it is in this conversation. */
export async function messageSentAt(threadId: string, messageId: string): Promise<string | null> {
  const { data } = await supabase.from("messages").select("sent_at").eq("thread_id", threadId).eq("id", messageId).maybeSingle();
  return data?.sent_at ?? null;
}

export async function loadMessage(messageId: string): Promise<Message | null> {
  const { data, error } = await supabase.from("messages").select(MESSAGE_COLUMNS).eq("id", messageId).maybeSingle();
  if (error) throw error;
  return data ? mapMessage((await openMessages([data]))[0]) : null;
}

/** A message's files, for a message that arrived over Realtime, whose payload carries none. */
export async function loadMessageAttachments(messageId: string): Promise<AttachmentRow[]> {
  const { data, error } = await supabase.from("attachments").select(ATTACHMENT_COLUMNS).eq("message_id", messageId).order("id");
  if (error) throw error;
  return data;
}

const ATTACHMENT_LIMIT = 1000;

/** Every file from every conversation, newest message first. Hidden files only when asked for. */
export async function loadAttachments(includeHidden = false): Promise<FiledAttachment[]> {
  let query = supabase
    .from("attachments")
    .select("id, filename, kind, size_bytes, storage_path, hidden_reason, messages!inner(id, thread_id, sent_at, direction, sender_contact_id, threads!inner(status))")
    // Files in deleted conversations (in the provider's bin) are left out, as the conversations are.
    .neq("messages.threads.status", "trash")
    .order("created_at", { ascending: false })
    .limit(ATTACHMENT_LIMIT);
  if (!includeHidden) query = query.eq("hidden", false);
  const { data, error } = await query;
  if (error) throw error;
  return data
    .flatMap(({ messages: m, ...a }) =>
      m
        ? [{
            ...mapAttachment(a),
            hiddenReason: (a.hidden_reason as Attachment["hiddenReason"]) ?? undefined,
            messageId: m.id,
            threadId: m.thread_id,
            sentAt: m.sent_at,
            from: m.direction === "outbound" ? "me" : m.sender_contact_id ?? "unknown",
          }]
        : [],
    )
    .sort((a, b) => b.sentAt.localeCompare(a.sentAt));
}
