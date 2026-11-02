// Folds a freshly loaded notes list into the one on screen. Pure: no network, no React. The provider
// (components/notes-data.tsx) calls it on every refresh (opening Notes, the tab coming back, Realtime).
// The rules: a note being edited here is never replaced; text already downloaded is kept when the row has not moved
// on; a row that moved on (another tab or device) comes back unopened so its new text is downloaded; and a note
// that is not in the list but is still being made or saved here is kept rather than dropped.

import { noteExcerpt } from "./note-text";
import type { Note } from "./notes";

export interface MergeHooks {
  /** The note has unsaved changes or text in the editor that is newer than the list. */
  isEditing: (id: string) => boolean;
  /** The note's row is still being written (a new note), so it is not in the loaded rows yet. */
  isCreating: (id: string) => boolean;
}

/** The list to show after loading `rows`, given the list `prev` now on screen. */
export function mergeLoaded(prev: Note[], rows: Note[], hooks: MergeHooks): Note[] {
  const before = new Map(prev.map((n) => [n.id, n]));
  const seen = new Set<string>();
  const out = rows.map((row) => {
    seen.add(row.id);
    const old = before.get(row.id);
    if (!old) return row;
    if (hooks.isEditing(row.id)) return old;
    // The rows were read before our own latest save landed: what is on screen is newer, so it stays.
    if (old.serverAt && row.serverAt && Date.parse(old.serverAt) > Date.parse(row.serverAt)) return old;
    // Same row version: the downloaded text is still right, so it is not closed again.
    if (!old.unloaded && !old.failed && old.serverAt === row.serverAt) {
      return { ...row, body: old.body, unloaded: false, excerpt: row.excerpt ?? noteExcerpt(old.body), stale: row.stale && old.stale, revision: old.revision };
    }
    // Changed elsewhere: unopened, and the editor (if this note is open) starts afresh with the new text.
    return old.unloaded ? { ...row, revision: old.revision } : { ...row, revision: (old.revision ?? 0) + 1 };
  });
  for (const n of prev) if (!seen.has(n.id) && (hooks.isEditing(n.id) || hooks.isCreating(n.id))) out.push(n);
  return out;
}
