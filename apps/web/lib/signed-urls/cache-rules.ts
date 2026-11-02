// Pure rules for the signed link cache (links.ts): how a link is keyed and when a cached one may be handed out again.
// No network or storage, so it is tested alone.

/** expires is when the link stops working, or for a failed one (value null), when to ask again. */
export type Entry = { url: Promise<string | null>; expires: number; value?: string | null };

/** The cache key of a link; thumbnails are kept apart from the original of the same file. */
export const keyOf = (bucket: string, path: string, thumb = false) => `${thumb ? "t\n" : ""}${bucket}\n${path}`;

/** Whether a cached entry may be reused: a remembered failure until its retry time, a link while it has more than minLeftMs left. */
export function fresh(entry: Entry | undefined, minLeftMs: number, now = Date.now()): entry is Entry {
  if (!entry) return false;
  if (entry.value === null) return now < entry.expires;
  return entry.expires - now > minLeftMs;
}
