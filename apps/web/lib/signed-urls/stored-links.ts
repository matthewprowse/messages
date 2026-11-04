// The signed link cache's stored form (links.ts keeps it in localStorage): whose links they are, and each link with
// when it stops working. Pure: no storage or network, so it is tested alone.

import type { Entry } from "./cache-rules";

/** One stored link: the cache key, the link, and when it stops working (ms since epoch). */
export type StoredLink = [key: string, url: string, expires: number];

type Stored = { user: string; links: Record<string, [string, number]> };

/**
 * The links of `user` read back from storage that still have more than minLeftMs left. Links stored for anyone else,
 * and anything malformed, read as none: a link is a bearer address to its owner's file.
 */
export function readStoredLinks(raw: string | null, user: string, now: number, minLeftMs: number): StoredLink[] {
  if (!raw) return [];
  let stored: Partial<Stored>;
  try {
    stored = JSON.parse(raw) as Partial<Stored>;
  } catch {
    return [];
  }
  if (!stored || stored.user !== user || typeof stored.links !== "object" || !stored.links) return [];
  const out: StoredLink[] = [];
  for (const [key, link] of Object.entries(stored.links)) {
    if (!Array.isArray(link)) continue;
    const [url, expires] = link;
    if (typeof url === "string" && typeof expires === "number" && expires - now > minLeftMs) out.push([key, url, expires]);
  }
  return out;
}

/**
 * The stored form of the cache for `user`: links that came back and still have more than minLeftMs left, the last
 * `max` of them in the cache's order (newest last), so a long day of browsing cannot grow it without end.
 */
export function storedLinksForm(cache: Iterable<[string, Entry]>, user: string, now: number, minLeftMs: number, max: number): string {
  const live: [string, [string, number]][] = [];
  for (const [key, e] of cache) if (e.value && e.expires - now > minLeftMs) live.push([key, [e.value, e.expires]]);
  return JSON.stringify({ user, links: Object.fromEntries(live.slice(-max)) } satisfies Stored);
}
