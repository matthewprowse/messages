import type { Json, Tables } from "@messages/db";
import { FIELD } from "@messages/crypto/fields";
import { chatIndexFor, companyRef } from "./address-refs";
import { addressIndex } from "@messages/crypto/addresses";
import { open, userKeys } from "./vault";
import { openAddresses } from "./open-rows";
import { supabase } from "./supabase";
import { mapContact } from "./data";
import { allRows, type ContactSummary } from "./contacts";
import { followMerges, type MergeSide } from "./merging";
import type { Contact } from "./types";

// Merging, splitting and undoing, and what the screens read about them. The database functions do the
// work and check that every contact is yours; reads go through row-level security like everything else.

export interface MergeSuggestion {
  id: string;
  contactA: string;
  contactB: string;
  reason: string;
  score: number;
}

export interface MergeRecord {
  id: string;
  mergedName: string;
  reason: string;
  createdAt: string;
  /** Providers of the address books whose cards hold the kept contact's addresses or numbers. */
  providers: string[];
}

export { contactErrorText as mergeErrorText } from "./contacts";

/** What the merge screens need to know about a person. */
export function mergeSide(c: ContactSummary): MergeSide {
  return { id: c.id, name: c.name, emails: c.emails, phones: c.phones, hasWhatsApp: c.hasWhatsApp, conversations: c.conversationCount };
}

export async function listSuggestions(): Promise<MergeSuggestion[]> {
  const { data, error } = await supabase
    .from("contact_suggestions")
    .select("id, contact_a, contact_b, reason, score")
    .eq("status", "pending")
    .order("score", { ascending: false })
    .limit(200);
  if (error) throw new Error(`Load suggestions failed (${error.code})`);
  return data.map((s) => ({ id: s.id, contactA: s.contact_a, contactB: s.contact_b, reason: s.reason, score: s.score }));
}

export async function dismissSuggestion(id: string): Promise<boolean> {
  const { error } = await supabase.from("contact_suggestions").update({ status: "dismissed" }).eq("id", id);
  return !error;
}

/** Automatic merges into this contact that can still be undone, newest first. */
export async function listAutomaticMerges(contactId: string, identities: { emails: string[]; phones: string[] }): Promise<MergeRecord[]> {
  const { data, error } = await supabase
    .from("contact_merges")
    .select("id, merged_snapshot, reason, created_at")
    .eq("kept_contact_id", contactId)
    .eq("automatic", true)
    .is("undone_at", null)
    .order("created_at", { ascending: false })
    .limit(20);
  if (error) throw new Error(`Load merges failed (${error.code})`);
  if (data.length === 0) return [];
  const providers = data.some((m) => m.reason === "address_book") ? await addressBookProviders(identities) : [];
  return data.map((m) => ({
    id: m.id,
    mergedName: String((m.merged_snapshot as { display_name?: unknown } | null)?.display_name ?? "").trim() || "Someone",
    reason: m.reason,
    createdAt: m.created_at,
    providers,
  }));
}

async function addressBookProviders({ emails, phones }: { emails: string[]; phones: string[] }): Promise<string[]> {
  // Cards are found by their addresses' indexes: the database matches on those, not the addresses.
  const keys = await userKeys();
  const [emailIndexes, phoneIndexes] = await Promise.all([emails, phones].map((list) => Promise.all(list.map((v) => addressIndex(keys, v)))));
  const queries = [];
  if (emails.length) queries.push(supabase.from("address_book_cards").select("accounts(provider)").overlaps("email_indexes", emailIndexes).limit(5));
  if (phones.length) queries.push(supabase.from("address_book_cards").select("accounts(provider)").overlaps("phone_indexes", phoneIndexes).limit(5));
  const results = await Promise.all(queries);
  return [...new Set(results.flatMap((r) => (r.data ?? []).flatMap((c) => (c.accounts?.provider ? [c.accounts.provider] : []))))];
}

/** Where a merged contact went: the contact it was merged into, followed through later merges. */
export async function resolveMergedContact(id: string): Promise<string | null> {
  const mergedInto: Record<string, string> = {};
  let current = id;
  for (let hop = 0; hop < 5; hop++) {
    const { data } = await supabase
      .from("contact_merges")
      .select("kept_contact_id")
      .eq("merged_contact_id", current)
      .is("undone_at", null)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!data) break;
    mergedInto[current] = data.kept_contact_id;
    current = data.kept_contact_id;
  }
  const end = followMerges(id, mergedInto);
  return end === id ? null : end;
}

export async function mergeContactsRpc(keepId: string, mergeId: string, reason: "suggestion" | "manual") {
  return supabase.rpc("merge_contacts", { p_keep: keepId, p_merge: mergeId, p_reason: reason });
}

/** Undoes a merge, returning the two contacts it involved so the screens can refresh them. */
export async function undoMergeRpc(mergeId: string) {
  const { data: row } = await supabase.from("contact_merges").select("kept_contact_id, merged_contact_id").eq("id", mergeId).maybeSingle();
  const { error } = await supabase.rpc("undo_merge", { p_merge: mergeId });
  return { error, keptId: row?.kept_contact_id, mergedId: row?.merged_contact_id };
}

export async function splitContactRpc(contactId: string, identityIds: string[], name: string) {
  // The new contact's company and the one-to-one chats under its numbers, worked out here because the
  // database matches on indexes and cannot read the addresses.
  const { data: rows } = await supabase.from("contact_identities").select("kind, value, created_at").in("id", identityIds).order("created_at");
  const moved = await Promise.all((rows ?? []).map(async (r) => ({ kind: r.kind, value: (await open(FIELD.address, r.value)) ?? "" })));
  const chats = (await Promise.all(moved.filter((m) => m.kind !== "email").map((m) => chatIndexFor(m.value)))).filter((c): c is string => !!c);
  return supabase.rpc("split_contact", {
    p_contact: contactId,
    p_identity_ids: identityIds,
    p_name: name,
    p_organization: (await companyRef(moved.find((m) => m.kind === "email")?.value)) as unknown as Json,
    p_chat_indexes: chats,
  });
}

/** Gives the kept contact the name chosen in the merge dialog, when the merge picked the other one. */
export async function keepName(contactId: string, name: string): Promise<void> {
  const { error } = await supabase.from("contacts").update({ display_name: name }).eq("id", contactId).neq("display_name", name);
  if (error) throw new Error(`Keep name failed (${error.code})`);
}

/** Every contact and who is in each conversation, reloaded after a contact is added, merged, split or deleted. */
export async function loadContactGraph(): Promise<{ contacts: Contact[]; participants: Map<string, string[]> }> {
  const [parts, contacts, identities] = await Promise.all([
    allRows("Load contacts", (from, to) => supabase.from("thread_participants").select("thread_id, contact_id").order("thread_id").order("contact_id").range(from, to)),
    allRows("Load contacts", (from, to) => supabase.from("contacts").select("*").order("id").range(from, to)),
    allRows("Load contacts", (from, to) => supabase.from("contact_identities").select("*").order("id").range(from, to)).then(openAddresses),
  ]);
  const participants = new Map<string, string[]>();
  for (const p of parts) {
    const list = participants.get(p.thread_id);
    if (list) list.push(p.contact_id);
    else participants.set(p.thread_id, [p.contact_id]);
  }
  const identitiesOf = new Map<string, Tables<"contact_identities">[]>();
  for (const i of identities) {
    const list = identitiesOf.get(i.contact_id);
    if (list) list.push(i);
    else identitiesOf.set(i.contact_id, [i]);
  }
  return { contacts: contacts.map((c) => mapContact(c, identitiesOf.get(c.id) ?? [])), participants };
}
