"use client";

// Reading and writing a note's links (note_links, 20261118180000_note_links.sql) and making a note straight from
// somewhere else in the app (a conversation, a contact, a meeting). This works without the Notes page's provider, so
// the Notes chip and quick capture can be used on any screen: a note made here opens at /notes/<id>, where the
// provider loads the list afresh. Titles are sealed with the user's keys, as everywhere in notes.

import { FIELD } from "@messages/crypto/fields";
import { supabase } from "./supabase";
import { open } from "./vault";
import { insertNoteRow } from "./notes";
import { linkColumn, linkInsert, targetOfRow, uniqueTargets, type LinkRow, type LinkTarget } from "./note-link-map";
import { track } from "./analytics";

/** A note as the Notes chip lists it. */
export interface LinkedNote { id: string; title: string; updatedAt: string }

/** Where a note's links are stored, as its id and target. */
export interface StoredLink { rowId: string; target: LinkTarget }

/** The links one note has. */
export async function loadNoteLinks(noteId: string): Promise<StoredLink[]> {
  const { data, error } = await supabase.from("note_links").select("id, note_id, contact_id, thread_id, event_id").eq("note_id", noteId);
  if (error) throw error;
  return (data as LinkRow[]).flatMap((r) => { const target = targetOfRow(r); return target ? [{ rowId: r.id, target }] : []; });
}

/** Links a note to these targets; ones it already has are left alone. */
export async function addNoteLinks(noteId: string, targets: LinkTarget[]): Promise<void> {
  const rows = uniqueTargets(targets).map((t) => linkInsert(noteId, t));
  if (rows.length === 0) return;
  // One insert each: the unique indexes are partial, which an upsert cannot name, and a repeat (23505) is fine.
  const results = await Promise.all(rows.map((r) => supabase.from("note_links").insert(r)));
  const failed = results.find((r) => r.error && r.error.code !== "23505");
  if (failed?.error) throw failed.error;
}

/** Takes one link off a note. */
export async function removeNoteLink(noteId: string, target: LinkTarget): Promise<void> {
  const { error } = await supabase.from("note_links").delete().eq("note_id", noteId).eq(linkColumn(target.kind), target.id);
  if (error) throw error;
}

/** The notes linked to a contact, conversation or event, newest edit first, archived ones left out. */
export async function loadLinkedNotes(target: LinkTarget): Promise<LinkedNote[]> {
  const { data, error } = await supabase.from("note_links").select("notes!inner(id, title, updated_at, archived)").eq(linkColumn(target.kind), target.id);
  if (error) throw error;
  const rows = (data as unknown as { notes: { id: string; title: string; updated_at: string; archived: boolean } }[]).map((r) => r.notes).filter((n) => !n.archived);
  const notes = await Promise.all(rows.map(async (n) => ({ id: n.id, title: (await open(FIELD.noteTitle, n.title)) ?? "", updatedAt: n.updated_at })));
  return notes.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export interface CaptureOptions {
  title?: string;
  body?: string;
  links?: LinkTarget[];
}

/**
 * Makes a note, with its text and links, and resolves to its id. The row is written first and the links after, so a
 * link never points at a note that is not there; a link that fails to save leaves the note, which opens regardless.
 */
export async function captureNote(opts: CaptureOptions = {}): Promise<string> {
  const id = crypto.randomUUID();
  await insertNoteRow(id, { title: opts.title ?? "", body: opts.body ?? "" });
  if (opts.links?.length) await addNoteLinks(id, opts.links).catch(() => {});
  track("feature_used", { feature: "note_created" });
  return id;
}
