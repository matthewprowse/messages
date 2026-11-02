"use client";

// For a file left at the mailbox: asks the worker to fetch it when the viewer opens, and reports where that stands.
// The polling itself is lib/attachment-fetch.ts; this wires it to the database and to React.

import { useEffect, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase";
import { fetchDeferredFile, isDeferredFile, type FetchApi, type FetchOutcome } from "@/lib/attachment-fetch";
import { withSealedColumns } from "@/lib/sealed-columns";
import type { Attachment } from "@/lib/types";

/** The calls behind fetchDeferredFile: the request row and the attachment row, read as the signed-in person. */
const fetchApi: FetchApi = {
  async request(attachmentId, again) {
    const db = supabase as unknown as SupabaseClient; // attachment_fetch_requests is not in the generated types yet
    const { data } = await supabase.auth.getSession();
    const userId = data.session?.user.id;
    if (!userId) return false;
    // A failed request is the only kind a person may remove; for any other this does nothing.
    if (again) await db.from("attachment_fetch_requests").delete().eq("attachment_id", attachmentId).not("error", "is", null);
    const { error } = await db.from("attachment_fetch_requests").insert({ attachment_id: attachmentId, user_id: userId });
    return !error || error.code === "23505"; // already asked: the worker has it
  },
  async check(attachmentId) {
    const db = supabase as unknown as SupabaseClient;
    const [row, req] = await Promise.all([
      supabase.from("attachments").select(await withSealedColumns("storage_path, team_path, sealed, not_kept")).eq("id", attachmentId).maybeSingle(),
      db.from("attachment_fetch_requests").select("error").eq("attachment_id", attachmentId).maybeSingle(),
    ]);
    if (row.error) throw new Error("check failed");
    const d = row.data as { storage_path?: string | null; team_path?: string | null; sealed?: boolean; not_kept?: string | null } | null;
    return { path: d?.team_path ?? d?.storage_path ?? null, sealed: !!d?.sealed, notKept: d?.not_kept ?? null, error: (req.data as { error?: string | null } | null)?.error ?? null };
  },
  wait: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  visible: () => document.visibilityState === "visible",
};

/**
 * For a file left at the mailbox: asks the worker for it when the viewer opens, and reports where that stands.
 * `path` is set once the file is stored. Other files are left alone (status "none").
 */
export function useRequestedFile(a: Attachment, open: boolean) {
  const deferred = isDeferredFile(a);
  const [tries, setTries] = useState(0);
  const [result, setResult] = useState<{ id: string; tries: number; outcome: FetchOutcome } | null>(null);
  useEffect(() => {
    if (!open || !deferred) return;
    let stopped = false;
    void fetchDeferredFile(fetchApi, a.id, tries > 0, () => stopped).then((outcome) => { if (outcome && !stopped) setResult({ id: a.id, tries, outcome }); });
    return () => { stopped = true; };
  }, [open, deferred, a.id, tries]);
  const mine = result?.id === a.id && result.tries === tries ? result.outcome : null;
  const status = !deferred ? "none" : mine?.kind === "ready" ? "ready" : mine?.kind === "error" ? "error" : "fetching";
  return {
    status,
    path: mine?.kind === "ready" ? mine.path : undefined,
    sealed: mine?.kind === "ready" ? mine.sealed : undefined,
    error: mine?.kind === "error" ? mine : null,
    retry: () => setTries((n) => n + 1),
  } as const;
}
