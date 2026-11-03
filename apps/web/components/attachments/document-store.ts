"use client";

// Where the document cards of files live in the browser: read from attachments.doc_card (sealed by the AI worker, opened here),
// shared by every tile, the viewer and the page's filters so a file is asked about once. Asking for a card inserts a
// document_reads row and checks until the card or an error appears. If the migration is not applied the cards are simply
// absent and nothing else is affected.

import { useCallback, useEffect, useSyncExternalStore } from "react";
import { FIELD } from "@messages/crypto/fields";
import { supabase } from "@/lib/supabase";
import { open } from "@/lib/vault";
import { parseDocCard, type DocCard } from "@/lib/search/document-card";

/** What is known about a file: its card, or why there is none. "waiting" while the worker reads it. */
export type DocEntry = { state: "card"; card: DocCard } | { state: "none" } | { state: "unread" } | { state: "waiting" } | { state: "error"; message: string };

const CHUNK = 100;
const POLL_MS = 2500; // ms
// A read takes a few seconds; one still waiting after this is stuck (the worker writes an error, such as AI being
// paused, when it cannot go on), so the page stops waiting rather than spinning on.
const GIVE_UP_MS = 45_000;

const entries = new Map<string, DocEntry>();
const asked = new Set<string>(); // ids already fetched (or being fetched) from the database
const listeners = new Set<() => void>();
let version = 0;
let missing = false; // the columns are not there yet

function set(id: string, entry: DocEntry) {
  entries.set(id, entry);
  version++;
  for (const l of listeners) l();
}

async function entryOf(row: { doc_card: string | null; doc_state: string | null }): Promise<DocEntry> {
  if (row.doc_state === "done" && row.doc_card) {
    const card = parseDocCard(await open(FIELD.docCard, row.doc_card).catch(() => null));
    if (card) return { state: "card", card };
  }
  return row.doc_state === "none" ? { state: "none" } : { state: "unread" };
}

/** Fetches the cards of files not asked about yet, a hundred at a time. */
async function load(ids: string[]) {
  const fresh = ids.filter((id) => !asked.has(id));
  if (missing || fresh.length === 0) return;
  for (const id of fresh) asked.add(id);
  for (let i = 0; i < fresh.length; i += CHUNK) {
    const part = fresh.slice(i, i + CHUNK);
    const { data, error } = await supabase.from("attachments").select("id, doc_card, doc_state").in("id", part);
    if (error) {
      if (error.code === "42703") missing = true;
      for (const id of part) asked.delete(id);
      return;
    }
    // A read the worker gave up on (AI paused, file unreadable) says why, after a reload too, rather than offering it again.
    const unread = (data ?? []).filter((row) => row.doc_state !== "done" && row.doc_state !== "none").map((row) => row.id);
    const failed = new Map<string, string>();
    if (unread.length) {
      const reads = await supabase.from("document_reads").select("attachment_id, error").in("attachment_id", unread).not("error", "is", null);
      for (const r of reads.data ?? []) if (r.error) failed.set(r.attachment_id, r.error);
    }
    const got = new Set<string>();
    for (const row of data ?? []) {
      got.add(row.id);
      const error = failed.get(row.id);
      const entry: DocEntry = error ? { state: "error", message: error } : await entryOf(row);
      if (entries.get(row.id)?.state !== "waiting") set(row.id, entry);
    }
    for (const id of part) if (!got.has(id) && !entries.has(id)) set(id, { state: "unread" });
  }
}

/** Asks the worker to read a file, then waits for its card. A failed earlier request is removed first, so Retry works. */
export async function requestCard(id: string): Promise<void> {
  set(id, { state: "waiting" });
  await supabase.from("document_reads").delete().eq("attachment_id", id).not("error", "is", null);
  const { error } = await supabase.from("document_reads").insert({ attachment_id: id });
  if (error && error.code !== "23505") {
    set(id, { state: "error", message: "The Request Could Not Be Made. Check Your Connection and Try Again." });
    return;
  }
  const until = Date.now() + GIVE_UP_MS;
  while (Date.now() < until) {
    await new Promise((r) => setTimeout(r, POLL_MS));
    if (document.visibilityState !== "visible") continue;
    const { data } = await supabase.from("attachments").select("doc_card, doc_state").eq("id", id).maybeSingle();
    if (data && (data.doc_state === "done" || data.doc_state === "none")) {
      set(id, await entryOf(data));
      return;
    }
    const failed = await supabase.from("document_reads").select("error").eq("attachment_id", id).maybeSingle();
    if (failed.data?.error) {
      set(id, { state: "error", message: failed.data.error });
      return;
    }
  }
  set(id, { state: "error", message: "This Is Taking Longer Than Expected. Try Again in a Moment." });
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => void listeners.delete(l);
};

/** The known entry of each of these files (undefined until fetched), fetching what is not known yet. Re-renders as entries arrive. */
export function useDocumentCards(ids: string[]): (id: string) => DocEntry | undefined {
  useSyncExternalStore(subscribe, () => version, () => 0);
  const key = ids.join(",");
  useEffect(() => { void load(key ? key.split(",") : []); }, [key]);
  return useCallback((id: string) => entries.get(id), []);
}
