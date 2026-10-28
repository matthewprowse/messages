"use client";

// Notes and the files attached to them. The title, text, excerpt and file names are always sealed with the
// user's keys, whatever the content-encryption switch says; older plaintext notes still open, and are
// sealed the next time they are saved. The list loads titles and excerpts only: a note's text is downloaded
// when the note opens, or in the background for search.
// Files are uploaded to the private attachments bucket at "<user id>/notes/<note id>/<uuid>", then a
// note_attachments row records them; the database checks the path and that the file is there.
// The bytes are sealed in the browser before upload (see sealNoteBytes) and uploaded as
// application/octet-stream; the real content type is kept in the row and the bytes are opened when the
// file is viewed or saved (lib/signed-urls.ts). Files uploaded before sealing began are still read as they are.

import { encryptBytes, encryptField, isCiphertext } from "@messages/crypto";
import { FIELD, type Field } from "@messages/crypto/fields";
import { supabase } from "./supabase";
import { open, openRows, userKeys } from "./vault";
import { noteExcerpt as excerptOf } from "./note-text";
import { BUCKET, formatBytes, mimeOf, uploadFile, displayName } from "./outbox-files";
import { rememberNoteMime } from "./signed-urls";
import type { Attachment } from "./types";

export interface Note {
  id: string;
  title: string;
  /** Markdown. Empty while `unloaded` is true. */
  body: string;
  /** The start of the note as plain text, for the list. Null for notes saved before excerpts: worked out from the body once it is downloaded. */
  excerpt: string | null;
  /** The body has not been downloaded yet (the list loads without it). */
  unloaded?: boolean;
  /** The body could not be downloaded. */
  failed?: boolean;
  /** What is stored is still plaintext or lacks an excerpt, so saving the note rewrites it sealed. */
  stale?: boolean;
  pinned: boolean;
  /** Given to the AI with every draft, for facts a reply may need (fees, checklists, addresses). */
  useInDrafts: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface NoteFile {
  id: string;
  noteId: string;
  path: string;
  name: string;
  mimeType: string;
  size: number;
}

/** Each file can be up to 50 MB: the Supabase Free plan stops uploads there. */
export const MAX_NOTE_FILE_BYTES = 50 * 1024 * 1024;

const NOTE_COLUMNS = "id, title, excerpt, pinned, use_in_drafts, created_at, updated_at";
const FILE_COLUMNS = "id, note_id, storage_path, name, mime_type, size_bytes";
type NoteRow = { id: string; title: string; excerpt: string | null; pinned: boolean; use_in_drafts: boolean; created_at: string; updated_at: string };
type FileRow = { id: string; note_id: string; storage_path: string; name: string; mime_type: string; size_bytes: number };

function mapNote(r: NoteRow, stale: boolean): Note {
  return { id: r.id, title: r.title ?? "", body: "", excerpt: r.excerpt, unloaded: true, stale, pinned: r.pinned, useInDrafts: r.use_in_drafts, createdAt: r.created_at, updatedAt: r.updated_at };
}

function mapFile(r: FileRow): NoteFile {
  rememberNoteMime(r.storage_path, r.mime_type);
  return { id: r.id, noteId: r.note_id, path: r.storage_path, name: r.name || "Attachment", mimeType: r.mime_type, size: r.size_bytes };
}

/** Encrypts note text with the user's keys, always: the content-encryption switch does not apply to notes. */
async function sealNote(field: Field, value: string): Promise<string> {
  return encryptField(await userKeys(), field, value);
}

/** A file's bytes sealed with the user's keys: a sealed-file header, a nonce, the ciphertext and its tag. */
export async function sealNoteBytes(file: Blob): Promise<Blob> {
  const sealed = await encryptBytes(await userKeys(), FIELD.noteFileData, new Uint8Array(await file.arrayBuffer()));
  return new Blob([sealed], { type: "application/octet-stream" });
}

/** What is stored for a title, body or excerpt that still needs rewriting sealed: text that is not encrypted. */
const isPlain = (v: string | null | undefined) => !!v && !isCiphertext(v);

/** Loads the list: titles and excerpts opened, bodies not downloaded (see loadNoteBodies). */
export async function loadNotes(): Promise<Note[]> {
  const { data, error } = await supabase.from("notes").select(NOTE_COLUMNS).order("updated_at", { ascending: false });
  if (error) throw error;
  const rows = data as NoteRow[];
  const stale = new Set(rows.filter((r) => r.excerpt === null || isPlain(r.title) || isPlain(r.excerpt)).map((r) => r.id));
  await openRows(rows, [["title", FIELD.noteTitle], ["excerpt", FIELD.noteExcerpt]]);
  return rows.map((r) => mapNote(r, stale.has(r.id)));
}

/** Downloads and opens the text of these notes. A note that is gone is left out; plain says it was stored unencrypted. */
export async function loadNoteBodies(ids: string[]): Promise<Map<string, { body: string; plain: boolean }>> {
  const { data, error } = await supabase.from("notes").select("id, body").in("id", ids);
  if (error) throw error;
  const rows = data as { id: string; body: string }[];
  const out = new Map<string, { body: string; plain: boolean }>();
  await Promise.all(rows.map(async (r) => { out.set(r.id, { body: (await open(FIELD.note, r.body)) ?? "", plain: isPlain(r.body) }); }));
  return out;
}

export async function createNote(): Promise<Note> {
  const { data, error } = await supabase.from("notes").insert({ excerpt: "" }).select(NOTE_COLUMNS).single();
  if (error) throw error;
  return { ...mapNote(data as NoteRow, false), unloaded: false };
}

/** Saves the title, text and excerpt, all sealed, resolving to the time the database stamped. */
export async function saveNote(id: string, note: { title: string; body: string }): Promise<string> {
  const [title, body, excerpt] = await Promise.all([
    sealNote(FIELD.noteTitle, note.title),
    sealNote(FIELD.note, note.body),
    sealNote(FIELD.noteExcerpt, excerptOf(note.body)),
  ]);
  const { data, error } = await supabase.from("notes").update({ title, body, excerpt }).eq("id", id).select("updated_at").single();
  if (error) throw error;
  return data.updated_at;
}

export async function pinNote(id: string, pinned: boolean): Promise<void> {
  const { error } = await supabase.from("notes").update({ pinned }).eq("id", id);
  if (error) throw error;
}

export async function useNoteInDrafts(id: string, on: boolean): Promise<void> {
  const { error } = await supabase.from("notes").update({ use_in_drafts: on }).eq("id", id);
  if (error) throw error;
}

/** Deletes a note and every file attached to it. */
export async function deleteNote(id: string): Promise<void> {
  const { data, error: filesError } = await supabase.from("note_attachments").select("storage_path").eq("note_id", id);
  if (filesError) throw filesError;
  const paths = data.map((r) => r.storage_path);
  // The row goes first (its attachment rows go with it), so a failed delete leaves the note with its files. Removing
  // the stored files after is best effort: a miss leaves unreachable files, not a note that has lost them.
  const { error } = await supabase.from("notes").delete().eq("id", id);
  if (error) throw error;
  if (paths.length) await supabase.storage.from(BUCKET).remove(paths).catch(() => {});
}

export async function loadNoteFiles(noteId: string): Promise<NoteFile[]> {
  const { data, error } = await supabase.from("note_attachments").select(FILE_COLUMNS).eq("note_id", noteId);
  if (error) throw error;
  const rows = await Promise.all((data as FileRow[]).map(async (r) => ({ ...r, name: (await open(FIELD.noteFile, r.name)) ?? "" })));
  return rows.map(mapFile);
}

/** Why a file cannot be attached, or null when it can. */
export function noteFileError(file: { name: string; size: number }): string | null {
  if (file.size <= 0) return `${displayName(file.name)} is empty.`;
  if (file.size > MAX_NOTE_FILE_BYTES) return `${displayName(file.name)} is over 50 MB.`;
  return null;
}

/** Uploads a file into a note, showing progress, and records it. */
export async function uploadNoteFile(noteId: string, file: File, name: string, onProgress?: (fraction: number) => void): Promise<NoteFile> {
  const { data } = await supabase.auth.getSession();
  const session = data.session;
  if (!session) throw new Error("Sign in again to attach files.");
  const mimeType = mimeOf(name, file.type);
  const path = `${session.user.id}/notes/${noteId}/${crypto.randomUUID()}`;
  const sealed = await sealNoteBytes(file);
  await uploadFile({
    base: process.env.NEXT_PUBLIC_SUPABASE_URL ?? "",
    apiKey: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? "",
    token: session.access_token,
    path,
    file: sealed,
    mimeType: "application/octet-stream",
    onProgress,
  });
  rememberNoteMime(path, mimeType);
  const { data: row, error } = await supabase
    .from("note_attachments")
    .insert({ note_id: noteId, storage_path: path, name: await sealNote(FIELD.noteFile, name), mime_type: mimeType, size_bytes: file.size })
    .select("id")
    .single();
  if (error) {
    await supabase.storage.from(BUCKET).remove([path]);
    throw error;
  }
  return { id: row.id, noteId, path, name, mimeType, size: file.size };
}

/** Deletes files taken out of a note. */
export async function removeNoteFiles(files: NoteFile[]): Promise<void> {
  if (files.length === 0) return;
  // The rows stay until the stored files are gone, so a failed removal is tried again next time.
  const { error: storageError } = await supabase.storage.from(BUCKET).remove(files.map((f) => f.path));
  if (storageError) throw storageError;
  const { error } = await supabase.from("note_attachments").delete().in("id", files.map((f) => f.id));
  if (error) throw error;
}

/** A note file as the attachment tiles and viewer take it. */
export function noteAttachment(f: NoteFile): Attachment {
  const m = f.mimeType;
  const kind: Attachment["kind"] = m.startsWith("image/") ? "image" : m.startsWith("video/") ? "video" : m.startsWith("audio/") ? "audio" : m === "application/pdf" ? "pdf" : "file";
  return { id: f.id, name: f.name, kind, size: formatBytes(f.size), path: f.path };
}
