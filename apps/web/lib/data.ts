// Turns database rows into the shapes the screens use, and loads them for the signed-in user.
// Row-level security keeps these to the user's own rows, with one exception: a team's work chats can also be read by
// whoever they are assigned to, and by Compliance under strict sharing (supabase/migrations/20261101120000). A list
// of chats or files asks for the user's own with user_id, so a colleague's chat never lands in someone's inbox.

import type { Tables } from "@messages/db";
import { openAddresses, openDrafts, openExamples, openMessages, openTasks, openThreads } from "./open-rows";
import { supabase } from "./supabase";
import type { Account, AccountStatus, Attachment, Category, Contact, Draft, FiledAttachment, Message, Priority, Profile, Provider, Rule, Task, Thread, Unsubscribe, WritingExample } from "./types";
import { formatPhone, formatSize, whenPhoneFormatReady } from "./format";
import { emailParts, emphasisRuns, type Emphasis } from "./email-text";
import type { ChoiceKind } from "./choices";
import { allRows, type ContactSummary } from "./contacts";
import { summariseStored, type Activity } from "./contact-summaries";
import { mergeThreads } from "./merge-threads";
import { mapTask, TASK_COLUMNS } from "./tasks";
import { withSealedColumns } from "./sealed-columns";
import { companyLogo, isCompanySender, logoAvatar } from "./people";

type ContactRow = Pick<Tables<"contacts">, "id" | "display_name" | "company" | "role" | "avatar_path"> & {
  organizations?: Pick<Tables<"organizations">, "id" | "name" | "logo_path"> | null;
};
type IdentityRow = Pick<Tables<"contact_identities">, "kind" | "value">;
type ThreadRow = Pick<
  Tables<"threads">,
  | "id" | "account_id" | "channel" | "subject" | "is_group" | "group_name" | "avatar_path" | "provider_thread_id" | "last_message_at"
  | "created_at" | "last_message_preview" | "junk" | "subscription" | "last_sender_contact_id" | "unread_count" | "pinned" | "status" | "priority" | "category" | "summary" | "needs_reply" | "last_from_me"
> & { workspace_id?: string | null; shared_by?: string | null; share_match?: string | null; share_suggestion?: string | null };
type AttachmentRow = Pick<Tables<"attachments">, "id" | "message_id" | "filename" | "kind" | "size_bytes" | "storage_path" | "hidden" | "sealed" | "not_kept"> & { team_path?: string | null; thumb_path?: string | null };
export type MessageRow = Pick<
  Tables<"messages">,
  "id" | "provider_message_id" | "thread_id" | "direction" | "sender_contact_id" | "sender_address" | "to_addresses" | "sent_at" | "subject" | "body_text" | "body_html" | "provider_meta" | "has_original" | "is_bulk" | "body_marks" | "transcript"
> & { attachments: AttachmentRow[] };

// With the company, whose logo stands in for the photo of a sender that writes as the company.
export const CONTACT_COLUMNS = "id, display_name, company, role, avatar_path, organizations(id, name, logo_path)";
const THREAD_COLUMNS =
  "id, account_id, channel, subject, is_group, group_name, avatar_path, provider_thread_id, last_message_at, created_at, last_message_preview, junk, subscription, last_sender_contact_id, unread_count, pinned, status, priority, category, summary, needs_reply, last_from_me, workspace_id, shared_by, share_match, share_suggestion";
// One thread with its account's provider and its people in full, for a single conversation that has only just appeared.
const THREAD_WITH_PEOPLE = `${THREAD_COLUMNS}, accounts(provider), thread_participants(contact_id, contacts(${CONTACT_COLUMNS}, contact_identities(kind, value)))` as const;
// The list: only the ids of who is in each thread. A person in fifty threads is sent once, by loadContacts, not fifty times here.
const THREAD_WITH_IDS = `${THREAD_COLUMNS}, accounts(provider), thread_participants(contact_id)` as const;
// Explicit lists, so a column the app never reads (a WhatsApp QR or pairing code) never reaches every page.
const ACCOUNT_COLUMNS = "id, provider, label, nickname, address, status, status_detail, last_synced_at, send_addresses";
const PROFILE_COLUMNS = "display_name, avatar_path, about, important_people, quiet_start, quiet_end, push_urgent, push_important, auto_draft_top, whatsapp_read_receipts, share_usage, language";
const DRAFT_COLUMNS = "id, thread_id, body, tone, instruction, decision, decision_kind, source, auto, updated_at";
export const UNSUBSCRIBE_COLUMNS = "id, account_id, sender_address, status, manual_url, error";
type AccountRow = Pick<Tables<"accounts">, "id" | "provider" | "label" | "nickname" | "address" | "status" | "status_detail" | "last_synced_at" | "send_addresses">;
type ProfileRow = Pick<Tables<"profiles">, "display_name" | "avatar_path" | "about" | "important_people" | "quiet_start" | "quiet_end" | "push_urgent" | "push_important" | "auto_draft_top" | "whatsapp_read_receipts" | "share_usage" | "language">;
type DraftRow = Pick<Tables<"drafts">, "id" | "body" | "tone" | "instruction" | "decision" | "decision_kind" | "source" | "auto" | "updated_at">;
type UnsubscribeRow = Pick<Tables<"unsubscribes">, "id" | "account_id" | "sender_address" | "status" | "manual_url" | "error">;
const ATTACHMENT_COLUMNS = "id, message_id, filename, kind, size_bytes, storage_path, team_path, hidden, sealed, not_kept";
// Named columns, never select("*"). body_html is only still set on emails stored before the HTML stopped
// being kept (View Original now fetches it); is_bulk and has_original carry what it was needed for.
const MESSAGE_COLUMNS = `id, provider_message_id, thread_id, direction, sender_contact_id, sender_address, to_addresses, sent_at, subject, body_text, body_html, provider_meta, has_original, is_bulk, body_marks, transcript, attachments(${ATTACHMENT_COLUMNS})` as const;

/** How many messages a conversation opens with, and how many more each scroll up loads. */
export const MESSAGE_PAGE = 200;

export const EMPTY_PROFILE: Profile = {
  name: "",
  avatarPath: null,
  about: "",
  people: "",
  quietStart: "22:00",
  quietEnd: "07:30",
  pushUrgent: true,
  pushImportant: true,
  autoDraftTop: true,
  whatsappReadReceipts: true,
  shareUsage: true,
  language: null,
};

function initialsOf(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] ?? "") + (parts.length > 1 ? parts[parts.length - 1][0] : "")).toUpperCase() || "?";
}

export function mapContact(row: ContactRow, identities: IdentityRow[]): Contact {
  const emails = identities.filter((i) => i.kind === "email").map((i) => i.value);
  // WhatsApp privacy IDs ("...@lid") stand in for a hidden number: they are not phone numbers.
  // Only phone and WhatsApp identities are numbers: an Instagram ID is a long number and a username is text.
  const phones = identities.filter((i) => (i.kind === "phone" || i.kind === "whatsapp") && !i.value.includes("@")).map((i) => i.value);
  const handles = identities.filter((i) => i.kind === "instagram_username").map((i) => i.value);
  const lids = identities.filter((i) => i.value.endsWith("@lid")).map((i) => i.value);
  const org = row.organizations ?? null;
  const who = { name: row.display_name, emails, phones, organizationName: org?.name ?? null };
  return {
    id: row.id,
    name: row.display_name,
    initials: initialsOf(row.display_name),
    hue: 0,
    emails,
    phones,
    handles: handles.length ? handles : undefined,
    lids: lids.length ? lids : undefined,
    company: row.company ?? undefined,
    role: row.role ?? undefined,
    avatarPath: row.avatar_path ?? companyLogo(who, logoAvatar(org?.logo_path)),
    isCompany: isCompanySender(who),
    organization: org ? { id: org.id, name: org.name, logoPath: org.logo_path ?? undefined } : undefined,
  };
}

/** A WhatsApp chat's own name when no person is stored for it: its number, or WhatsApp for its own account. */
function whatsappChatName(chatId: string): string | undefined {
  const user = chatId.split("@")[0];
  if (!/^\d+$/.test(user)) return undefined;
  return user.length < 6 ? "WhatsApp" : formatPhone(`+${user}`);
}

/** The conversation is shown as its first participant, so whoever sent the latest message leads. An email
 *  can have several people in it, such as a forward from one that copies in another. */
export function leadParticipant(participantIds: string[], lead: string | null | undefined): string[] {
  if (lead && participantIds[0] !== lead && participantIds.includes(lead)) return [lead, ...participantIds.filter((id) => id !== lead)];
  return participantIds;
}

export function mapThread(row: ThreadRow, participantIds: string[], provider: Provider): Thread {
  participantIds = leadParticipant(participantIds, row.last_sender_contact_id);
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
    lastFromMe: row.last_from_me,
    lastSenderId: row.last_sender_contact_id ?? undefined,
    workspaceId: row.workspace_id ?? undefined,
    sharedBy: (row.shared_by as Thread["sharedBy"]) ?? undefined,
    shareMatch: row.share_match ?? undefined,
    shareSuggestion: row.share_suggestion === "suggested" ? "suggested" : undefined,
  };
}

type ThreadWithPeople = ThreadRow & {
  accounts: { provider: string } | null;
  thread_participants: { contact_id: string; contacts: (ContactRow & { contact_identities: IdentityRow[] }) | null }[];
};

type ThreadWithIds = ThreadRow & { accounts: { provider: string } | null; thread_participants: { contact_id: string }[] };

/** A listed thread row with the ids of its people. */
export function threadWithIds(row: ThreadWithIds): Thread {
  return mapThread(row, row.thread_participants.map((p) => p.contact_id), (row.accounts?.provider as Provider | undefined) ?? "icloud");
}

/** A thread row with its people embedded, and those people as contacts. */
function threadWithPeople(row: ThreadWithPeople, contacts: Map<string, Contact>): Thread {
  for (const p of row.thread_participants) {
    if (p.contacts && !contacts.has(p.contact_id)) contacts.set(p.contact_id, mapContact(p.contacts, p.contacts.contact_identities));
  }
  return mapThread(row, row.thread_participants.map((p) => p.contact_id), (row.accounts?.provider as Provider | undefined) ?? "icloud");
}

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

export function mapAccount(row: AccountRow): Account {
  return {
    id: row.id,
    provider: row.provider as Provider,
    label: row.label,
    nickname: row.nickname ?? undefined,
    detail: row.address,
    status: row.status as AccountStatus,
    statusDetail: row.status_detail ?? undefined,
    lastSync: row.last_synced_at ?? undefined,
    sendAddresses: row.send_addresses ?? [],
  };
}

function mapProfile(row: ProfileRow | null): Profile {
  if (!row) return EMPTY_PROFILE;
  return {
    name: row.display_name ?? "",
    avatarPath: row.avatar_path,
    about: row.about ?? "",
    people: row.important_people ?? "",
    quietStart: row.quiet_start.slice(0, 5),
    quietEnd: row.quiet_end.slice(0, 5),
    pushUrgent: row.push_urgent,
    pushImportant: row.push_important,
    autoDraftTop: row.auto_draft_top,
    whatsappReadReceipts: row.whatsapp_read_receipts,
    shareUsage: row.share_usage,
    language: row.language as Profile["language"],
  };
}

/** Profile fields as database columns, for saving a partial change. */
export function profilePatch(patch: Partial<Profile>) {
  const out: Partial<Tables<"profiles">> = {};
  if (patch.name !== undefined) out.display_name = patch.name;
  if (patch.avatarPath !== undefined) out.avatar_path = patch.avatarPath;
  if (patch.about !== undefined) out.about = patch.about;
  if (patch.people !== undefined) out.important_people = patch.people;
  if (patch.quietStart !== undefined) out.quiet_start = patch.quietStart;
  if (patch.quietEnd !== undefined) out.quiet_end = patch.quietEnd;
  if (patch.pushUrgent !== undefined) out.push_urgent = patch.pushUrgent;
  if (patch.pushImportant !== undefined) out.push_important = patch.pushImportant;
  if (patch.autoDraftTop !== undefined) out.auto_draft_top = patch.autoDraftTop;
  if (patch.whatsappReadReceipts !== undefined) out.whatsapp_read_receipts = patch.whatsappReadReceipts;
  if (patch.shareUsage !== undefined) out.share_usage = patch.shareUsage;
  if (patch.language !== undefined) out.language = patch.language;
  return out;
}

export function mapDraft(row: DraftRow): Draft {
  return {
    id: row.id,
    body: row.body,
    tone: row.tone as Draft["tone"],
    instruction: row.instruction ?? undefined,
    decision: row.decision && row.decision_kind ? { text: row.decision, kind: row.decision_kind as ChoiceKind } : undefined,
    source: row.source ?? undefined,
    auto: row.auto || undefined,
    generatedAt: row.updated_at,
  };
}

export function mapUnsubscribe(row: UnsubscribeRow): Unsubscribe {
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
  /** Every contact, from one loadContacts. Empty when that failed, and the store then retries it (see store.tsx). */
  contacts: Contact[];
  /** Whether contacts holds everyone. False when loading them failed, which the store then retries. */
  contactsLoaded: boolean;
  accounts: Account[];
  rules: Rule[];
  writingExamples: WritingExample[];
  profile: Profile;
  unsubscribes: Unsubscribe[];
  /** Tasks with a due date: every open one, and completed ones due in the last TASK_DAYS days or later. */
  tasks: Task[];
}

/** A deliberate product cap: the list holds the newest 1000 conversations; older ones are found by search. */
const THREAD_LIMIT = 1000;
/** The most conversations a catch-up after a dropped connection reads; more than that and everything is reloaded. */
const CHANGE_LIMIT = 200;
/** How far back completed tasks are shown in Calendar. Open ones are loaded however old, as they are overdue. */
const TASK_DAYS = 60;


/** The signed-in user's ID, from the session held in the browser. */
async function myId(): Promise<string> {
  return (await supabase.auth.getSession()).data.session?.user.id ?? "";
}

/** Tasks with a due date: every open one however old, and completed ones from the last TASK_DAYS days. Paged, so none is cut at 1000. */
export async function loadTasks(): Promise<Task[]> {
  const taskSince = new Date(Date.now() - TASK_DAYS * 86_400_000).toISOString();
  // id breaks ties between tasks due at the same moment, so paging neither repeats nor skips one.
  const rows = await allRows("Load tasks", (from, to) =>
    supabase.from("tasks").select(TASK_COLUMNS).not("due_at", "is", null).or(`status.eq.open,due_at.gte.${taskSince}`).order("due_at").order("id").range(from, to));
  await openTasks(rows);
  return rows.map(mapTask);
}

/** The small tables behind the list screens: everything except the conversations and contacts. */
async function loadSmall() {
  const [accounts, profile, rules, examples, drafts, unsubscribes, followUps, tasks] = await Promise.all([
    supabase.from("accounts").select(ACCOUNT_COLUMNS),
    supabase.from("profiles").select(PROFILE_COLUMNS).maybeSingle(),
    allRows("Load rules", (from, to) => supabase.from("priority_rules").select("id, kind, target").order("created_at", { ascending: false }).order("id").range(from, to)),
    allRows("Load examples", (from, to) => supabase.from("writing_examples").select("id, situation, body").order("created_at", { ascending: false }).order("id").range(from, to)),
    // A new message's draft (no conversation) lives in its dialog only.
    allRows("Load drafts", (from, to) => supabase.from("drafts").select(DRAFT_COLUMNS).eq("status", "active").not("thread_id", "is", null).order("id").range(from, to)),
    allRows("Load unsubscribes", (from, to) => supabase.from("unsubscribes").select(UNSUBSCRIBE_COLUMNS).order("id").range(from, to)),
    // Not required: without it (the table not there yet) the Waiting filter is just empty.
    allRows("Load follow-ups", (from, to) => supabase.from("follow_ups").select("thread_id").eq("expects_reply", true).order("id").range(from, to)).catch(() => []),
    // Not required either: without it (no task account, or the table not there yet) Calendar shows events only.
    loadTasks().catch(() => []),
  ]);
  if (accounts.error) throw accounts.error;
  if (profile.error) throw profile.error;
  await Promise.all([
    openDrafts(drafts),
    openAddresses([accounts.data ?? [], rules, unsubscribes]),
    openExamples(examples),
  ]);
  const draftOf = new Map(drafts.map((d) => [d.thread_id, mapDraft(d)]));
  const waiting = new Set(followUps.map((f) => f.thread_id));
  return {
    draftOf,
    waiting,
    accounts: (accounts.data ?? []).map(mapAccount),
    rules: rules.map((r) => ({ id: r.id, kind: r.kind as Rule["kind"], target: r.target })),
    writingExamples: examples.map((w) => ({ id: w.id, context: w.situation, text: w.body })),
    profile: mapProfile(profile.data),
    unsubscribes: unsubscribes.map(mapUnsubscribe),
    tasks,
  };
}

/** Everything the list screens need, in parallel. Messages load per conversation when it is opened. */
export async function loadEverything(): Promise<Loaded> {
  const me = await myId();
  // Independent of the queries, so it loads beside them instead of after.
  const phoneReady = whenPhoneFormatReady();
  const [threads, small, contacts] = await Promise.all([
    // Deleted conversations (in the provider's bin) are never shown, so they are not loaded.
    supabase.from("threads").select(THREAD_WITH_IDS).eq("user_id", me).neq("status", "trash")
      .order("last_message_at", { ascending: false, nullsFirst: false }).limit(THREAD_LIMIT),
    loadSmall(),
    // Not required: without them names are missing until the store tries again, but the list still opens.
    loadContacts().catch(() => null),
  ]);
  if (threads.error) throw threads.error;
  await Promise.all([openThreads(threads.data ?? []), phoneReady]);
  const { draftOf, waiting, ...rest } = small;
  return {
    threads: (threads.data ?? []).map((t) => ({ ...threadWithIds(t), draft: draftOf.get(t.id), waiting: waiting.has(t.id) })),
    contacts: contacts ?? [],
    contactsLoaded: !!contacts,
    ...rest,
  };
}

/**
 * What changed since a time, for catching up after a short dropped connection: the conversations updated since
 * (with their people) merged into the ones held, and the small tables again. Does not see a conversation deleted
 * for good in the meantime, so a long gap reloads everything instead. Throws when it cannot say, such as when more
 * than a page changed.
 */
export async function loadChanges(since: string, current: Thread[]): Promise<Loaded> {
  const me = await myId();
  const [changed, small] = await Promise.all([
    // Trash is included, so a conversation moved to the bin leaves the list.
    supabase.from("threads").select(THREAD_WITH_PEOPLE).eq("user_id", me).gt("updated_at", since).order("updated_at").limit(CHANGE_LIMIT),
    loadSmall(),
  ]);
  if (changed.error) throw changed.error;
  if ((changed.data?.length ?? 0) >= CHANGE_LIMIT) throw new Error("Too many changes to catch up");
  await openThreads(changed.data ?? []);
  await whenPhoneFormatReady();
  const contacts = new Map<string, Contact>();
  const rows = changed.data ?? [];
  const threads = rows.map((t) => threadWithPeople(t, contacts));
  const gone = new Set(rows.filter((t) => t.status === "trash").map((t) => t.id));
  const { draftOf, waiting, ...rest } = small;
  return {
    threads: mergeThreads(current, threads, gone).map((t) => ({ ...t, draft: draftOf.get(t.id), waiting: waiting.has(t.id) })),
    contacts: [...contacts.values()],
    contactsLoaded: false,
    ...rest,
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

/** The Contacts list from the store's contacts, or null when the store is missing someone. Throws when a read fails. */
export async function listContactsFromStore(stored: Contact[]): Promise<ContactSummary[] | null> {
  const [rows, activity, whatsapp] = await Promise.all([
    allRows("Load contacts", (from, to) => supabase.from("contacts").select("id, hidden").order("id").range(from, to)),
    allRows("Load contact summaries", (from, to) => supabase.rpc("contact_summaries").order("contact_id").range(from, to)),
    allRows("Load contacts", (from, to) => supabase.from("contact_identities").select("id, contact_id").eq("kind", "whatsapp").order("id").range(from, to)),
  ]);
  return summariseStored(
    rows,
    new Map(stored.map((c) => [c.id, c])),
    new Map(activity.map((a) => [a.contact_id, a as Activity])),
    new Set(whatsapp.map((w) => w.contact_id)),
  );
}

/** One conversation with its people, for one that has only just been created. */
export async function loadThread(threadId: string): Promise<{ thread: Thread; contacts: Contact[] } | null> {
  const { data, error } = await supabase.from("threads").select(THREAD_WITH_PEOPLE).eq("id", threadId).maybeSingle();
  if (error) throw error;
  if (!data) return null;
  await openThreads([data]);
  await whenPhoneFormatReady();
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
export async function loadThreadMessages(threadId: string, at: { before?: Pick<Message, "id" | "sentAt">; from?: string; limit?: number } = {}): Promise<MessagePage> {
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
  const size = at.limit ?? MESSAGE_PAGE;
  const page = await messagePage(threadId, at.before, undefined, size);
  return { messages: page.reverse(), more: page.length === size };
}

/**
 * The messages sent after one, oldest first, for catching up on a conversation that is already open.
 * Null when a whole page came back, as there may be more: the caller then reloads the conversation.
 */
export async function loadMessagesAfter(threadId: string, after: Pick<Message, "id" | "sentAt">): Promise<Message[] | null> {
  const { data, error } = await supabase.from("messages").select(await withSealedColumns(MESSAGE_COLUMNS)).eq("thread_id", threadId)
    .or(`sent_at.gt."${after.sentAt}",and(sent_at.eq."${after.sentAt}",id.gt.${after.id})`)
    .order("sent_at").order("id").limit(MESSAGE_PAGE);
  if (error) throw error;
  if (data.length >= MESSAGE_PAGE) return null;
  return (await openMessages(data)).map(mapMessage);
}

/** Up to limit messages older than before (if given) and no older than from (if given), newest first. */
async function messagePage(threadId: string, before: Pick<Message, "id" | "sentAt"> | undefined, from: string | undefined, limit: number): Promise<Message[]> {
  let query = supabase.from("messages").select(await withSealedColumns(MESSAGE_COLUMNS)).eq("thread_id", threadId);
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
  const { data, error } = await supabase.from("messages").select(await withSealedColumns(MESSAGE_COLUMNS)).eq("id", messageId).maybeSingle();
  if (error) throw error;
  return data ? mapMessage((await openMessages([data]))[0]) : null;
}

/** A message's files, for a message that arrived over Realtime, whose payload carries none. */
export async function loadMessageAttachments(messageId: string): Promise<AttachmentRow[]> {
  const { data, error } = await supabase.from("attachments").select(await withSealedColumns(ATTACHMENT_COLUMNS)).eq("message_id", messageId).order("id");
  if (error) throw error;
  return openAddresses(data);
}

const ATTACHMENT_LIMIT = 1000;

/**
 * Every file from every conversation, newest message first. Hidden files only when asked for.
 * Voice notes and stickers belong to their chats and are left out: this is the library of pictures,
 * video, PDFs and documents.
 */
export async function loadAttachments(includeHidden = false): Promise<FiledAttachment[]> {
  let query = supabase
    .from("attachments")
    .select(await withSealedColumns("id, filename, kind, size_bytes, storage_path, hidden_reason, sealed, not_kept, messages!inner(id, thread_id, sent_at, direction, sender_contact_id, threads!inner(status))"))
    .eq("user_id", await myId())
    // Files in deleted conversations (in the provider's bin) are left out, as the conversations are.
    .neq("messages.threads.status", "trash")
    .neq("kind", "audio")
    .eq("is_sticker", false)
    .order("created_at", { ascending: false })
    .limit(ATTACHMENT_LIMIT);
  if (!includeHidden) query = query.eq("hidden", false);
  const { data: sealedRows, error } = await query;
  if (error) throw error;
  const data = await openAddresses(sealedRows);
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
