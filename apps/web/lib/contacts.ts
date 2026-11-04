// Contacts as the pages need them. The worker creates a contact for every new sender and stores each
// email address or phone number as an identity, so one person can have several of each.
// Reads go through the signed-in browser client, so row-level security limits them to the user's own rows.
// One contact's page is read in contact-detail.ts.

import type { PostgrestError } from "@supabase/supabase-js";
import type { Json } from "@messages/db";
import { FIELD, type Field } from "@messages/crypto/fields";
import { allRows } from "./all-rows";
import { companyRef, identityRefs } from "./address-refs";
import { openAddresses } from "./open-rows";
import { supabase } from "./supabase";
import { open, seal } from "./vault";
import { normalisePhone, PHONE_HINT } from "./new-items";
import { isEmail } from "./send-from";
import type { FiledAttachment, Provider } from "./types";
import { companyLogo, isCompanySender, logoAvatar } from "./people";

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
  /** Instagram usernames, without the @. */
  handles: string[];
  /** Has a LinkedIn identity (its id is not a name or a link, so only the fact is shown). */
  hasLinkedIn: boolean;
  /** The user's own word on person or company, when the guess was wrong. */
  kindOverride?: "person" | "company";
  /** Left out of the People list; shown under Hidden. */
  hidden: boolean;
  /** Starred: pinned to the top of People, always priority in triage. Added by the Contacts layout (contact-relations.ts). */
  vip?: boolean;
  /** Client, Prospect, Colleague... or whatever was typed. */
  relationship?: string | null;
  /** Newest message from them and from you in one-to-one conversations, for the status line and Going Quiet. */
  lastInboundAt?: string | null;
  lastOutboundAt?: string | null;
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
  /** Where a lead came from, such as "Property24 Enquiry" (contacts.lead_source, set by an automation). */
  leadSource: string | null;
  summary: string | null;
  /** What the user wrote about them (contacts.about_note, opened here). */
  aboutNote: string | null;
  /** The company filed for their email domain, if any. */
  organization: { id: string; name: string } | null;
  conversations: ContactConversation[];
  /** Files in their one-to-one conversations, plus the ones they sent to groups. Newest first. */
  attachments: FiledAttachment[];
  /** Every address and number with its id, for Split. */
  identityRows: { id: string; kind: string; value: string }[];
  /** Drawn from what the app already held while the full read is on its way (lib/contact-detail-cache.ts): no files, notes or address ids yet. */
  partial?: boolean;
}

type Identity = { kind: string; value: string };

/** A contact's addresses and numbers, split by kind. */
export function identities(rows: Identity[]) {
  const emails = rows.filter((i) => i.kind === "email").map((i) => i.value);
  // WhatsApp privacy IDs ("...@lid") stand in for a hidden number: they are not phone numbers.
  const phones = [...new Set(rows.filter((i) => (i.kind === "phone" || i.kind === "whatsapp") && !i.value.includes("@")).map((i) => i.value))];
  const handles = [...new Set(rows.filter((i) => i.kind === "instagram_username").map((i) => i.value.replace(/^@/, "")))];
  return { emails, phones, handles, hasWhatsApp: rows.some((i) => i.kind === "whatsapp"), hasLinkedIn: rows.some((i) => i.kind === "linkedin") };
}

/** The newest of some timestamps, or null when there are none. */
export function latest(dates: Iterable<string | null | undefined>) {
  let out: string | null = null;
  for (const d of dates) if (d && (!out || d > out)) out = d;
  return out;
}

// Kept exported from here, where every caller already imports it.
export { allRows };

/** The stored person or company override, or undefined for anything else. */
export function asKind(value: string | null | undefined): "person" | "company" | undefined {
  return value === "person" || value === "company" ? value : undefined;
}

export async function listContacts(): Promise<ContactSummary[]> {
  const select = "id, display_name, company, role, hidden, avatar_path, kind_override, organizations(name, logo_path), contact_identities(kind, value)";
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
    const kindOverride = asKind(c.kind_override);
    const who = { name: c.display_name, ...ids, organizationName: c.organizations?.name ?? null, kindOverride };
    return {
      id: c.id,
      name: c.display_name,
      kindOverride,
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
    // Sealed here: the database stores names as given and never reads them.
    p_name: await seal(FIELD.name, c.name.trim()),
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
        // null keeps the name just saved (resealing it would mark it as renamed by you).
        p_name: null,
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
  return await failed(error, "Could not add the contact. Check your connection and try again.");
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
async function failed(error: PostgrestError | null, fallback: string): Promise<CreateResult> {
  if (error?.code === "23505") {
    // The function passes the contact's id (a race with sync does not). Their name is sealed, so it is read and opened
    // here to say whose it is.
    const existingId = isUuid(error.details ?? "") ? error.details : undefined;
    if (!existingId) return { ok: false, error: "One of these is already on another contact." };
    const name = await existingName(existingId);
    return { ok: false, error: name ? `One of these already belongs to ${name}.` : "One of these already belongs to another contact.", existingId };
  }
  return { ok: false, error: contactErrorText(error, fallback) };
}

/** A contact's name, opened, or null when it cannot be read. */
async function existingName(id: string): Promise<string | null> {
  const { data } = await supabase.from("contacts").select("display_name").eq("id", id).maybeSingle();
  if (!data) return null;
  return (await open(FIELD.name, data.display_name).catch(() => null))?.trim() || null;
}

export interface ContactEdit {
  name: string;
  /** The name before editing. When the name is unchanged it is not sent, so it is neither sealed again nor marked as yours. */
  previousName?: string;
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

/** Files a sender under People ("person") or Companies ("company") whatever the guess says; null goes back to the guess. */
export async function setContactKind(id: string, kind: "person" | "company" | null): Promise<boolean> {
  const { error } = await supabase.from("contacts").update({ kind_override: kind }).eq("id", id);
  return !error;
}

/** Saves a person's name, details, and added or removed addresses and numbers. A name set here is kept by syncs. */
export async function updateContact(id: string, c: ContactEdit): Promise<CreateResult> {
  const { refs } = await newIdentities(c.addEmails, c.addPhones);
  const unchanged = c.previousName !== undefined && c.previousName.trim() === c.name.trim();
  const { error } = await supabase.rpc("update_contact", {
    p_contact: id,
    // Sealed here; null keeps the stored name (the database cannot compare sealed names).
    p_name: unchanged ? null : await seal(FIELD.name, c.name.trim()),
    p_company: await sealText(FIELD.contactCompany, c.company),
    p_role: await sealText(FIELD.contactRole, c.role),
    p_relationship: await sealText(FIELD.contactRelationship, c.relationship),
    p_add: refs,
    p_remove: c.remove,
  });
  if (!error) return { ok: true, id };
  return await failed(error, "Could not save. Check your connection and try again.");
}

/** Deletes a person and their addresses and numbers. Conversations and messages stay. Resolves to an error message, or null. */
export async function deleteContact(id: string): Promise<string | null> {
  const { error } = await supabase.rpc("delete_contact", { p_contact: id });
  return error ? contactErrorText(error, "Could not delete the contact. Check your connection and try again.") : null;
}
