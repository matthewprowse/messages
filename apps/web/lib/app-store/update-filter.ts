// Tells a Realtime UPDATE of a message that changed something shown from one that did not. Marking a conversation read
// updates every message in it and changes nothing on screen, so those are skipped before any decrypting happens.
// The payload carries no old row (the table has the default replica identity), so the last one seen per message is remembered.

/** The columns that can change what a message shows after it arrived: reactions, edits, deletions, a transcript and its status. */
export type ShownColumns = { provider_meta?: unknown; body_text?: string | null; transcript?: string | null; transcript_status?: string | null };

export interface UpdateFilter {
  /** True when this row differs from the last one seen for the message in a shown column (or none was seen yet). Remembers it. */
  changed(id: string, row: ShownColumns): boolean;
  clear(): void;
}

/** Remembers at most max messages, forgetting all of them when full (a missed skip only costs one extra patch). */
export function createUpdateFilter(max = 2000): UpdateFilter {
  const seen = new Map<string, string>();
  return {
    changed(id, row) {
      // Sealed text is identical until it is rewritten, so the stored string itself is the signature. Columns left out of a payload read as undefined.
      const key = JSON.stringify([row.provider_meta ?? null, row.body_text ?? null, row.transcript ?? null, row.transcript_status ?? null]);
      if (seen.get(id) === key) return false;
      if (seen.size >= max) seen.clear();
      seen.set(id, key);
      return true;
    },
    clear: () => seen.clear(),
  };
}
