// Reading and writing a contact's matters and what they hold (public.matters, public.matter_links). The name is sealed with the
// user's key (field "name") and opened here. Each call rejects on failure so the hook can put the screen back and show a toast.

import { FIELD } from "@messages/crypto/fields";
import { supabase } from "../supabase";
import { open, seal } from "../vault";
import { LINK_COLUMN, mapMatter, mapMatterLink, type Matter, type MatterKind, type MatterLink } from "./matters";
import type { RefKind } from "./types";

const COLUMNS = "id, contact_id, name, kind, status, created_at, closed_at";
const LIMIT = 200;

/** The contact's matters and everything they hold. A name that cannot be opened reads as its kind. */
export async function loadMatters(contactId: string): Promise<{ matters: Matter[]; links: MatterLink[] }> {
  const { data, error } = await supabase.from("matters").select(COLUMNS).eq("contact_id", contactId).limit(LIMIT);
  if (error) throw new Error(`Load matters failed (${error.code})`);
  const opened = await Promise.all(data.map(async (r) => ({ ...r, name: (await open(FIELD.name, r.name).catch(() => null)) ?? "" })));
  const matters = opened.map(mapMatter);
  if (matters.length === 0) return { matters, links: [] };
  const found = await supabase.from("matter_links").select("id, matter_id, thread_id, note_id, attachment_id, meeting_id").in("matter_id", matters.map((m) => m.id));
  if (found.error) throw new Error(`Load matters failed (${found.error.code})`);
  return { matters, links: found.data.flatMap((r) => mapMatterLink(r) ?? []) };
}

/** Makes a matter and returns it. */
export async function createMatter(contactId: string, name: string, kind: MatterKind): Promise<Matter> {
  const { data, error } = await supabase.from("matters").insert({ contact_id: contactId, name: await seal(FIELD.name, name), kind }).select(COLUMNS).single();
  if (error) throw new Error(`Save matter failed (${error.code})`);
  return mapMatter({ ...data, name });
}

/** Renames a matter and may change its kind. */
export async function renameMatter(id: string, name: string, kind: MatterKind): Promise<void> {
  const { error } = await supabase.from("matters").update({ name: await seal(FIELD.name, name), kind }).eq("id", id);
  if (error) throw new Error(`Save matter failed (${error.code})`);
}

/** Closes a matter, or opens it again. Closing keeps everything it holds. */
export async function setMatterClosed(id: string, closed: boolean): Promise<void> {
  const { error } = await supabase.from("matters").update({ status: closed ? "closed" : "open", closed_at: closed ? new Date().toISOString() : null }).eq("id", id);
  if (error) throw new Error(`Save matter failed (${error.code})`);
}

/** Deletes a matter. What it held is not touched: only the grouping goes. */
export async function deleteMatter(id: string): Promise<void> {
  const { error } = await supabase.from("matters").delete().eq("id", id);
  if (error) throw new Error(`Delete matter failed (${error.code})`);
}

/** Puts an item in a matter. Resolves to the new link, or null when it was already there. */
export async function addToMatter(matterId: string, kind: RefKind, targetId: string): Promise<MatterLink | null> {
  const { data, error } = await supabase.from("matter_links").insert({ matter_id: matterId, thread_id: kind === "thread" ? targetId : null, note_id: kind === "note" ? targetId : null, attachment_id: kind === "attachment" ? targetId : null, meeting_id: kind === "meeting" ? targetId : null }).select("id, matter_id, thread_id, note_id, attachment_id, meeting_id").single();
  // 23505 is the unique index: it was already there, which is fine.
  if (error) { if (error.code === "23505") return null; throw new Error(`Save matter failed (${error.code})`); }
  return mapMatterLink(data);
}

/** Takes an item out of a matter. */
export async function removeFromMatter(matterId: string, kind: RefKind, targetId: string): Promise<void> {
  const { error } = await supabase.from("matter_links").delete().eq("matter_id", matterId).eq(LINK_COLUMN[kind], targetId);
  if (error) throw new Error(`Save matter failed (${error.code})`);
}
