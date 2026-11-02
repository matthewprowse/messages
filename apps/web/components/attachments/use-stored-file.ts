"use client";

// Finds where a file is stored and hands the viewer a link to show it and one to save it. Note files and sealed
// attachments are opened in the browser and come back as blob links; the rest get a signed link.

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { withSealedColumns } from "@/lib/sealed-columns";
import { acquireNoteFile, isNotePath, mimeFor, rememberNoteMime, signedUrl } from "@/lib/signed-urls";
import { ATTACHMENT_BUCKET as BUCKET, VIEW_MIN_LEFT_MS, downloadLink } from "@/lib/attachment-view";
import type { Attachment } from "@/lib/types";

// sealed: a note file opened in the browser, so view and download are blob links rather than signed ones.
export type StoredFile = { id: string; state: "loading" } | { id: string; state: "missing" } | { id: string; state: "ready"; path: string; view: string; download: string; sealed: boolean };

// Asked for again on each open (usually from cache), so a link kept from an earlier open has time left.
export function useStoredFile(a: Attachment, open: boolean): StoredFile | null {
  const [file, setFile] = useState<StoredFile | null>(null);
  // Keyed on the fields used, so a store refresh that rebuilds the attachment object does not reload it.
  const { id, path: knownPath, name, kind, sealed: knownSealed } = a;
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    let release: (() => void) | undefined;
    setFile((f) => (f?.id === id && f.state === "ready" ? f : { id, state: "loading" }));
    (async (): Promise<StoredFile> => {
      let path = knownPath;
      let sealed = !!knownSealed;
      if (!path) {
        const { data } = await supabase.from("attachments").select(await withSealedColumns("storage_path, team_path, sealed")).eq("id", id).maybeSingle();
        path = data?.team_path ?? data?.storage_path ?? undefined;
        sealed = !!data?.sealed;
      }
      if (isNotePath(path) || (path && sealed)) {
        // A note file or a sealed attachment is opened here: it is unsealed in the browser and held until the viewer closes.
        rememberNoteMime(path!, mimeFor({ name, kind }));
        const handle = acquireNoteFile(path!);
        release = handle.release;
        if (cancelled) release();
        const opened = await handle.promise;
        if (!opened) return { id, state: "missing" };
        return { id, state: "ready", path, view: opened.url, download: opened.sealed ? opened.url : downloadLink(opened.url, name), sealed: opened.sealed };
      }
      const view = path ? await signedUrl(BUCKET, path, VIEW_MIN_LEFT_MS) : null;
      return path && view ? { id, state: "ready", path, view, download: downloadLink(view, name), sealed: false } : { id, state: "missing" };
    })()
      .then((next) => { if (!cancelled) setFile(next); })
      .catch(() => { if (!cancelled) setFile({ id, state: "missing" }); });
    return () => { cancelled = true; release?.(); };
  }, [id, knownPath, name, kind, knownSealed, open]);
  return file?.id === id ? file : null;
}
