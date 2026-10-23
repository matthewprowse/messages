import type { PostgrestError } from "@supabase/supabase-js";
import type { Json } from "@messages/db";
import { companyRef, identityRefs } from "./address-refs";
import { openAddresses, openNestedThreads } from "./open-rows";
import { supabase } from "./supabase";
import { formatSize } from "./format";
import type { Attachment, FiledAttachment } from "./types";

// Contacts as the pages need them. The worker creates a contact for every new sender and stores each
// email address or phone number as an identity, so one person can have several of each.
// Reads go through the signed-in browser client, so row-level security limits them to the user's own rows.

export interface ContactSummary {
  id: string;
  name: string;
  company: string | null;
  role: string | null;
  emails: string[];
  phones: string[];
  /** Latest message in any conversation with them, or null if there is none yet. */
  lastAt: string | null;
  /** Their photo in the private avatars bucket. */
  avatarPath?: string;
  /** The company filed for their email domain, if any. */
  organizationName: string | null;
  /** Conversations with them, not counting deleted ones. */
  conversationCount: number;
  /** Has a WhatsApp chat, even when WhatsApp hides the number. */
  hasWhatsApp: boolean;
}

export interface ContactConversation {
  id: string;
  channel: "email" | "whatsapp";
  isGroup: boolean;
  title: string;
  preview: string | null;
  lastAt: string | null;
}

export interface ContactDetail extends ContactSummary {
  relationship: string | null;
  summary: string | null;
  /** The company filed for their email domain, if any. */
  organization: { id: string; name: string } | null;
  conversations: ContactConversation[];
  /** Files in their one-to-one conversations, plus the ones they sent to groups. Newest first. */
  attachments: FiledAttachment[];
  /** Every address and number with its id, for Split. */
  identityRows: { id: string; kind: string; value: string }[];
}

type Identity = { kind: string; value: string };

/** A contact's addresses and numbers, split by kind. */
export function identities(rows: Identity[]) {
  const emails = rows.filter((i) => i.kind === "email").map((i) => i.value);
  // WhatsApp privacy IDs ("...@lid") stand in for a hidden number: they are not phone numbers.
  const phones = [...new Set(rows.filter((i) => i.kind !== "email" && !i.value.includes("@")).map((i) => i.value))];
  return { emails, phones, hasWhatsApp: rows.some((i) => i.kind === "whatsapp") };
}

/** The newest of some timestamps, or null when there are none. */
export function latest(dates: Iterable<string | null | undefined>) {
  let out: string | null = null;
  for (const d of dates) if (d && (!out || d > out)) out = d;
  return out;
}

const PAGE = 1000; // the most rows the API returns for one request

/** Every row of a query, a page at a time. The query must have a stable order so no row is missed. */
export async function allRows<T>(label: string, page: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: PostgrestError | null }>) {
  const data: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const result = await page(from, from + PAGE - 1);
    if (result.error) throw new Error(`${label} failed (${result.error.code})`);
    data.push(...(result.data ?? []));
    if ((result.data?.length ?? 0) < PAGE) return data;
  }
}

export async function listContacts(): Promise<ContactSummary[]> {
  const select = "id, display_name, company, role, avatar_path, organizations(name), contact_identities(kind, value), thread_participants(threads(last_message_at, status))";
  const data = await openAddresses(await allRows("Load contacts", (from, to) => supabase.from("contacts").select(select).order("id").range(from, to)));
  return data.map((c) => {
    // Deleted conversations (in the provider's bin) are not counted, as in Conversations.
    const threads = c.thread_participants.flatMap((p) => (p.threads && p.threads.status !== "trash" ? [p.threads] : []));
    return {
      id: c.id,
      name: c.display_name,
      company: c.organizations?.name ?? c.company,
      role: c.role,
      ...identities(c.contact_identities),
      lastAt: latest(threads.map((t) => t.last_message_at)),
      avatarPath: c.avatar_path ?? undefined,
      organizationName: c.organizations?.name ?? null,
      conversationCount: threads.length,
    };
  });
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(id: string) {
  return UUID.test(id);
}

export async function getContact(id: string): Promise<ContactDetail | null> {
  if (!isUuid(id)) return null;
  const { data: c, error } = await supabase
    .from("contacts")
    .select(
      "id, display_name, company, role, relationship, ai_summary, avatar_path, organizations(id, name), contact_identities(id, kind, value), thread_participants(threads(id, channel, subject, group_name, is_group, status, last_message_preview, last_message_at))",
    )
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(`Load contact failed (${error.code})`);
  if (!c) return null;
  await openNestedThreads([c]);
  // Deleted conversations (in the provider's bin) are left out here, as in Conversations.
  const conversations = c.thread_participants
    .flatMap((p) => (p.threads && p.threads.status !== "trash" ? [p.threads] : []))
    .map((t) => ({
      id: t.id,
      channel: t.channel as ContactConversation["channel"],
      isGroup: t.is_group,
      title: (t.is_group ? t.group_name : t.subject) ?? (t.channel === "whatsapp" ? "WhatsApp" : "No Subject"),
      preview: t.last_message_preview,
      lastAt: t.last_message_at,
    }))
    .sort((a, b) => (b.lastAt ?? "").localeCompare(a.lastAt ?? ""));
  const groupIds = new Set(c.thread_participants.flatMap((p) => (p.threads?.is_group && p.threads.status !== "trash" ? [p.threads.id] : [])));
  return {
    id: c.id,
    name: c.display_name,
    company: c.company,
    role: c.role,
    relationship: c.relationship,
    summary: c.ai_summary,
    organization: c.organizations ? { id: c.organizations.id, name: c.organizations.name } : null,
    organizationName: c.organizations?.name ?? null,
    ...identities(c.contact_identities),
    lastAt: conversations[0]?.lastAt ?? null,
    avatarPath: c.avatar_path ?? undefined,
    conversations,
    conversationCount: conversations.length,
    identityRows: c.contact_identities,
    attachments: await contactAttachments(c.id, conversations.map((t) => t.id), groupIds),
  };
}

async function contactAttachments(contactId: string, threadIds: string[], groupIds: Set<string>): Promise<FiledAttachment[]> {
  if (threadIds.length === 0) return [];
  const data = await allRows("Load contact attachments", (from, to) =>
    supabase
      .from("attachments")
      .select("id, filename, kind, size_bytes, storage_path, hidden_reason, messages!inner(id, thread_id, sent_at, direction, sender_contact_id)")
      .eq("hidden", false)
      .in("messages.thread_id", threadIds)
      .order("id")
      .range(from, to),
  );
  return data
    .filter((a) => !groupIds.has(a.messages.thread_id) || a.messages.sender_contact_id === contactId)
    .map((a) => ({
      id: a.id,
      name: a.filename,
      kind: a.kind as Attachment["kind"],
      size: formatSize(a.size_bytes),
      path: a.storage_path ?? undefined,
      hiddenReason: (a.hidden_reason as Attachment["hiddenReason"]) ?? undefined,
      messageId: a.messages.id,
      threadId: a.messages.thread_id,
      sentAt: a.messages.sent_at,
      from: a.messages.direction === "outbound" ? "me" : a.messages.sender_contact_id ?? "unknown",
    }))
    .sort((a, b) => b.sentAt.localeCompare(a.sentAt));
}

export interface NewContact {
  name: string;
  /** Lowercased addresses. */
  emails: string[];
  /** Numbers in E.164. */
  phones: string[];
  company: string;
}

export type CreateResult = { ok: true; id: string } | { ok: false; error: string; existingId?: string };

/** Errors the contact functions raise on purpose carry a message meant for people; anything else does not. */
export function contactErrorText(error: Pick<PostgrestError, "code" | "message"> | null, fallback: string): string {
  if (error && ["22023", "P0002", "23514", "55000", "42501"].includes(error.code) && error.message) return error.message;
  return fallback;
}

/** Adds a person. When an address or number is already someone's, says whose so they can be opened instead. */
export async function createContact(c: NewContact): Promise<CreateResult> {
  const emails = [...new Set(c.emails.map((e) => e.trim().toLowerCase()).filter(Boolean))];
  const phones = [...new Set(c.phones.map((p) => p.trim()).filter(Boolean))];
  const { data, error } = await supabase.rpc("create_contact", {
    p_name: c.name,
    p_identities: (await identityRefs([...emails.map((value) => ({ kind: "email", value })), ...phones.map((value) => ({ kind: "phone", value }))])) as unknown as Json,
    p_company: c.company,
    p_organization: (await companyRef(emails[0])) as unknown as Json,
  });
  if (!error && data) return { ok: true, id: data };
  if (error?.code === "23505") {
    // The function names the contact in the message and passes its id; a race with sync does not.
    const existingId = isUuid(error.details ?? "") ? error.details : undefined;
    return { ok: false, error: existingId ? error.message : "One of these is already on another contact.", existingId };
  }
  return { ok: false, error: contactErrorText(error, "Could not add the contact. Check your connection and try again.") };
}

/** Deletes a person and their addresses and numbers. Conversations and messages stay. Resolves to an error message, or null. */
export async function deleteContact(id: string): Promise<string | null> {
  const { error } = await supabase.rpc("delete_contact", { p_contact: id });
  return error ? contactErrorText(error, "Could not delete the contact. Check your connection and try again.") : null;
}
