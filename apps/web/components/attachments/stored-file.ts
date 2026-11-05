// What the attachment viewer is handed for a stored file (use-stored-file.ts), kept apart from the hook so it can be
// tested without a download. A sealed file's blob link is revoked a few seconds after it is released, so a released one
// may stay on screen while the viewer animates closed but is never handed out again.

// sealed: a note file opened in the browser, so view and download are blob links rather than signed ones, and blob is
// the decrypted file itself (the PDF viewer reads that, so a revoked link cannot break it).
export type StoredFile = { id: string; state: "loading" } | { id: string; state: "missing" } | { id: string; state: "too_large" } | { id: string; state: "ready"; path: string; view: string; download: string; sealed: boolean; blob?: Blob };

/** The hook's own state: released marks a blob link the effect that opened it has let go. */
export type HeldFile = StoredFile & { released?: true };

/** The state once the effect that opened it lets it go (the viewer closed or moved on). */
export function releasedFile(f: HeldFile | null): HeldFile | null {
  return f?.state === "ready" && f.sealed ? { ...f, released: true } : f;
}

/**
 * The file to show for an attachment. On reopen the first render comes before the effect that opens the file again, and
 * pdf.js handed the dead link fails ("Unexpected server response (0)"), so a released link shows as loading while open.
 */
export function shownFile(f: HeldFile | null, id: string, open: boolean): StoredFile | null {
  if (f?.id !== id) return null;
  if (f.state === "ready" && f.released) return open ? { id, state: "loading" } : f;
  return f;
}
