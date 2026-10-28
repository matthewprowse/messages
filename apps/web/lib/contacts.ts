// Contacts as the pages need them. The worker creates a contact for every new sender and stores each
// email address or phone number as an identity, so one person can have several of each.
// Reads go through the signed-in browser client, so row-level security limits them to the user's own rows.

import type { PostgrestError } from "@supabase/supabase-js";
import type { Json } from "@messages/db";
import { FIELD, type Field } from "@messages/crypto/fields";
import { companyRef, identityRefs } from "./address-refs";
import { openAddresses, openNestedThreads } from "./open-rows";
import { supabase } from "./supabase";
import { seal } from "./vault";
import { formatSize } from "./format";
import { normalisePhone, PHONE_HINT } from "./new-items";
import { isEmail } from "./send-from";
import type { Attachment, FiledAttachment, Provider } from "./types";
import { companyLogo, isCompanySender, logoAvatar } from "./people";
import { withSealedColumns } from "./sealed-columns";

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
  /** Writes as a company rather than as themselves, which picks their avatar's icon. */
  isCompany: boolean;
  /** The company filed for their email domain, if any. */
  organizationName: string | null;
  /** Conversations with them, not counting deleted ones. */
  conversationCount: number;
  /** Has a WhatsApp chat, even when WhatsApp hides the number. */
  hasWhatsApp: boolean;
  /** Left out of the People list; shown under Hidden. */
  hidden: boolean;
}

export interface ContactConversation {
  id: string;
  channel: "email" | "whatsapp";
  /** The service it comes from, for its logo. */
  provider?: Provider;
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
  const phones = [...new Set(rows.filter((i) => (i.kind === "phone" || i.kind === "whatsapp") && !i.value.includes("@")).map((i) => i.value))];
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
  const select = "id, display_name, company, role, hidden, avatar_path, organizations(name, logo_path), contact_identities(kind, value)";
  // Last activity and conversation counts come from one database call (one row per contact, deleted
  // conversations left out), so the list no longer loads every conversation of every contact.
  const [rows, summaries] = await Promise.all([
    allRows("Load contacts", (from, to) => supabase.from("contacts").select(select).order("id").range(from, to)),
    allRows("Load contact summaries", (from, to) => supabase.rpc("contact_summaries").order("contact_id").range(from, to)),
  ]);
  const data = await openAddresses(rows);
  const byContact = new Map(summaries.map((s) => [s.contact_id, s]));
  return data.map((c) => {
    const summary = byContact.get(c.id);
    const ids = identities(c.contact_identities);
    const who = { name: c.display_name, ...ids, organizationName: c.organizations?.name ?? null };
    return {
      id: c.id,
      name: c.display_name,
      company: c.organizations?.name ?? c.company,
      role: c.role,
      hidden: c.hidden,
      ...ids,
      // A contact with no conversations has no activity, so they sort last.
      lastAt: (summary?.last_at as string | null | undefined) ?? null,
      avatarPath: c.avatar_path ?? companyLogo(who, logoAvatar(c.organizations?.logo_path)),
      isCompany: isCompanySender(who),
      organizationName: c.organizations?.name ?? null,
      conversationCount: summary?.conversation_count ?? 0,
    };
  });
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(id: string) {
  return UUID.test(id);
}

export async function getContact(id: string): Promise<ContactDetail | null> {
  if (!isUuid(id)) return null;
  const { data: base, error } = await supabase
    .from("contacts")
    .select("id, display_name, company, role, relationship, ai_summary, hidden, avatar_path, organizations(id, name, logo_path), contact_identities(id, kind, value)")
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(`Load contact failed (${error.code})`);
  if (!base) return null;
  // Their conversations are paged, so a contact with thousands of them is not cut off or too big for one response.
  const thread_participants = await allRows("Load contact conversations", (from, to) =>
    supabase
      .from("thread_participants")
      .select("thread_id, threads(id, channel, subject, group_name, is_group, status, last_message_preview, last_message_at, accounts(provider))")
      .eq("contact_id", id)
      .order("thread_id")
      .range(from, to),
  );
  const c = { ...base, thread_participants };
  await openNestedThreads([c]);
  // Deleted conversations (in the provider's bin) are left out here, as in Conversations.
  const conversations = c.thread_participants
    .flatMap((p) => (p.threads && p.threads.status !== "trash" ? [p.threads] : []))
    .map((t) => ({
      id: t.id,
      channel: t.channel as ContactConversation["channel"],
      provider: (t.accounts?.provider ?? undefined) as Provider | undefined,
      isGroup: t.is_group,
      title: (t.is_group ? t.group_name : t.subject) ?? (t.channel === "email" ? "No Subject" : ({ whatsapp: "WhatsApp", instagram: "Instagram", linkedin: "LinkedIn", teams: "Teams", zoom: "Zoom", google_chat: "Google Chat" } as Record<string, string>)[t.channel] ?? "Conversation"),
      preview: t.last_message_preview,
      lastAt: t.last_message_at,
    }))
    .sort((a, b) => (b.lastAt ?? "").localeCompare(a.lastAt ?? ""));
  const groupIds = new Set(conversations.filter((t) => t.isGroup).map((t) => t.id));
  const ids = identities(c.contact_identities);
  const who = { name: c.display_name, ...ids, organizationName: c.organizations?.name ?? null };
  return {
    id: c.id,
    name: c.display_name,
    company: c.company,
    role: c.role,
    relationship: c.relationship,
    hidden: c.hidden,
    summary: c.ai_summary,
    organization: c.organizations ? { id: c.organizations.id, name: c.organizations.name } : null,
    organizationName: c.organizations?.name ?? null,
    ...ids,
    lastAt: conversations[0]?.lastAt ?? null,
    avatarPath: c.avatar_path ?? companyLogo(who, logoAvatar(c.organizations?.logo_path)),
    isCompany: isCompanySender(who),
    conversations,
    conversationCount: conversations.length,
    identityRows: c.contact_identities,
    attachments: await contactAttachments(c.id, conversations.map((t) => t.id), groupIds),
  };
}

const ATTACHMENT_THREADS = 100;

async function contactAttachments(contactId: string, threadIds: string[], groupIds: Set<string>): Promise<FiledAttachment[]> {
  if (threadIds.length === 0) return [];
  const columns = await withSealedColumns("id, filename, kind, size_bytes, storage_path, team_path, hidden_reason, sealed, not_kept, messages!inner(id, thread_id, sent_at, direction, sender_contact_id)");
  // The ids go in the address of each request, so they are asked in chunks to keep it short.
  const chunks: string[][] = [];
  for (let i = 0; i < threadIds.length; i += ATTACHMENT_THREADS) chunks.push(threadIds.slice(i, i + ATTACHMENT_THREADS));
  const data = (
    await Promise.all(
      chunks.map((ids) =>
        allRows("Load contact attachments", (from, to) =>
          supabase
            .from("attachments")
            .select(columns)
            .eq("hidden", false)
            .in("messages.thread_id", ids)
            .order("id")
            .range(from, to),
        ),
      ),
    )
  ).flat();
  await openAddresses(data);
  return data
    .filter((a) => !groupIds.has(a.messages.thread_id) || a.messages.sender_contact_id === contactId)
    .map((a) => ({
      id: a.id,
      name: a.filename,
      kind: a.kind as Attachment["kind"],
      size: formatSize(a.size_bytes),
      path: a.team_path ?? a.storage_path ?? undefined,
      sealed: a.sealed || undefined,
      notKept: (a.not_kept as Attachment["notKept"]) ?? undefined,
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
  role?: string;
  relationship?: string;
}

/** What New Contact and Edit Contact both check before saving: a name, and addresses and numbers that parse. */
export function checkContactFields(f: { name: string; emails: string[]; phones: string[] }, country: string) {
  const emailErrors = f.emails.map((e) => (e.trim() && !isEmail(e) ? "Check this address." : null));
  const phoneValues = f.phones.map((p) => (p.trim() ? normalisePhone(p, country) : null));
  const phoneErrors = f.phones.map((p, i) => (p.trim() && !phoneValues[i] ? PHONE_HINT : null));
  const nameError = f.name.trim() ? null : "Add a name.";
  const valid = !nameError && !emailErrors.some(Boolean) && !phoneErrors.some(Boolean);
  return { nameError, emailErrors, phoneValues, phoneErrors, valid };
}

export type CreateResult = { ok: true; id: string; /** Set when the contact was added but its company, role or relationship was not saved. */ warning?: string } | { ok: false; error: string; existingId?: string };

/** Errors the contact functions raise on purpose carry a message meant for people; anything else does not. */
export function contactErrorText(error: Pick<PostgrestError, "code" | "message"> | null, fallback: string): string {
  if (error && ["22023", "P0002", "23514", "55000", "42501"].includes(error.code) && error.message) return error.message;
  return fallback;
}

/** Adds a person. When an address or number is already someone's, says whose so they can be opened instead. */
export async function createContact(c: NewContact): Promise<CreateResult> {
  const { emails, refs } = await newIdentities(c.emails, c.phones);
  const { data, error } = await supabase.rpc("create_contact", {
    p_name: c.name,
    p_identities: refs,
    // Company, role and relationship are sealed, which create_contact cannot take; they are saved just after with update_contact.
    p_company: "",
    p_organization: (await companyRef(emails[0])) as unknown as Json,
  });
  if (!error && data) {
    // create_contact takes no role or relationship, so they are saved with the same call Edit uses.
    const role = c.role?.trim() ?? "";
    const relationship = c.relationship?.trim() ?? "";
    if (c.company.trim() || role || relationship) {
      const saved = await supabase.rpc("update_contact", {
        p_contact: data,
        p_name: c.name,
        p_company: await sealText(FIELD.contactCompany, c.company),
        p_role: await sealText(FIELD.contactRole, role),
        p_relationship: await sealText(FIELD.contactRelationship, relationship),
        p_add: [] as unknown as Json,
        p_remove: [],
      });
      if (saved.error) {
        console.error(`Save role failed (${saved.error.code})`);
        return { ok: true, id: data, warning: "The contact was added, but the company, role and relationship were not saved. Edit the contact to add them." };
      }
    }
    return { ok: true, id: data };
  }
  return failed(error, "Could not add the contact. Check your connection and try again.");
}

/** A detail to store: sealed in the browser when it has text, left empty when it has none (the functions read "" as cleared). */
async function sealText(field: Field, value: string): Promise<string> {
  const text = value.trim();
  return text ? seal(field, text) : "";
}

/** Deduplicated addresses (lowercased) and numbers, as the refs the contact functions take. */
async function newIdentities(rawEmails: string[], rawPhones: string[]) {
  const emails = [...new Set(rawEmails.map((e) => e.trim().toLowerCase()).filter(Boolean))];
  const phones = [...new Set(rawPhones.map((p) => p.trim()).filter(Boolean))];
  const refs = (await identityRefs([...emails.map((value) => ({ kind: "email", value })), ...phones.map((value) => ({ kind: "phone", value }))])) as unknown as Json;
  return { emails, refs };
}

/** A failed create or update. When an address or number is already someone's, says whose. */
function failed(error: PostgrestError | null, fallback: string): CreateResult {
  if (error?.code === "23505") {
    // The function names the contact in the message and passes its id; a race with sync does not.
    const existingId = isUuid(error.details ?? "") ? error.details : undefined;
    return { ok: false, error: existingId ? error.message : "One of these is already on another contact.", existingId };
  }
  return { ok: false, error: contactErrorText(error, fallback) };
}

export interface ContactEdit {
  name: string;
  company: string;
  role: string;
  relationship: string;
  /** New addresses (lowercased) and numbers (E.164). */
  addEmails: string[];
  addPhones: string[];
  /** contact_identities ids to remove. */
  remove: string[];
}

/** Hides a contact from the People list, or brings them back. Their conversations are untouched. */
export async function setContactHidden(id: string, hidden: boolean): Promise<boolean> {
  const { error } = await supabase.from("contacts").update({ hidden }).eq("id", id);
  return !error;
}

/** Saves a person's name, details, and added or removed addresses and numbers. A name set here is kept by syncs. */
export async function updateContact(id: string, c: ContactEdit): Promise<CreateResult> {
  const { refs } = await newIdentities(c.addEmails, c.addPhones);
  const { error } = await supabase.rpc("update_contact", {
    p_contact: id,
    p_name: c.name,
    p_company: await sealText(FIELD.contactCompany, c.company),
    p_role: await sealText(FIELD.contactRole, c.role),
    p_relationship: await sealText(FIELD.contactRelationship, c.relationship),
    p_add: refs,
    p_remove: c.remove,
  });
  if (!error) return { ok: true, id };
  return failed(error, "Could not save. Check your connection and try again.");
}

/** Deletes a person and their addresses and numbers. Conversations and messages stay. Resolves to an error message, or null. */
export async function deleteContact(id: string): Promise<string | null> {
  const { error } = await supabase.rpc("delete_contact", { p_contact: id });
  return error ? contactErrorText(error, "Could not delete the contact. Check your connection and try again.") : null;
}
