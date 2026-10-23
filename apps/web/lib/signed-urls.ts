"use client";

import { useEffect, useState } from "react";
import { supabase } from "./supabase";

// Photos and attachments live in private buckets, so each needs a short-lived signed link. Links asked
// for in the same tick (a grid of thumbnails, a list of avatars) go out as one request per bucket, and
// a link is handed out again while it has enough time left.

const LINK_SECONDS = 60 * 60;
const MAX_PER_REQUEST = 100;
const RETRY_FAILED_MS = 60 * 1000;
/** Default time a cached link must still have left, enough for a thumbnail or avatar to load. */
const MIN_LEFT_MS = 10 * 60 * 1000;

// expires is when the link stops working, or for a failed one, when to ask again.
type Entry = { url: Promise<string | null>; expires: number; value?: string | null };

const cache = new Map<string, Entry>();
const waiting = new Map<string, Map<string, ((url: string | null) => void)[]>>(); // bucket, then path
let scheduled = false;

const keyOf = (bucket: string, path: string) => `${bucket}\n${path}`;

function fresh(entry: Entry | undefined, minLeftMs: number): entry is Entry {
  if (!entry) return false;
  if (entry.value === null) return Date.now() < entry.expires;
  return entry.expires - Date.now() > minLeftMs;
}

async function ask(bucket: string, paths: string[]): Promise<Map<string, string>> {
  try {
    const { data } = await supabase.storage.from(bucket).createSignedUrls(paths, LINK_SECONDS);
    return new Map((data ?? []).flatMap((d) => (d.path && d.signedUrl && !d.error ? [[d.path, d.signedUrl] as const] : [])));
  } catch {
    return new Map();
  }
}

function flush() {
  scheduled = false;
  const batches = [...waiting];
  waiting.clear();
  for (const [bucket, byPath] of batches) {
    const paths = [...byPath.keys()];
    for (let i = 0; i < paths.length; i += MAX_PER_REQUEST) {
      const chunk = paths.slice(i, i + MAX_PER_REQUEST);
      void ask(bucket, chunk).then((found) => {
        for (const path of chunk) {
          const url = found.get(path) ?? null;
          for (const resolve of byPath.get(path) ?? []) resolve(url);
        }
      });
    }
  }
}

/**
 * A signed link to a stored file, or null when there is none. A cached link is reused only while it
 * has more than minLeftMs left, so a viewer kept open can ask for more headroom than a thumbnail.
 */
export function signedUrl(bucket: string, path: string, minLeftMs = MIN_LEFT_MS): Promise<string | null> {
  const key = keyOf(bucket, path);
  const hit = cache.get(key);
  if (fresh(hit, minLeftMs)) return hit.url;
  const entry: Entry = {
    expires: Date.now() + LINK_SECONDS * 1000,
    url: new Promise((resolve) => {
      const byPath = waiting.get(bucket) ?? new Map<string, ((url: string | null) => void)[]>();
      waiting.set(bucket, byPath);
      byPath.set(path, [...(byPath.get(path) ?? []), resolve]);
      if (!scheduled) {
        scheduled = true;
        setTimeout(flush, 0);
      }
    }),
  };
  // A failure is remembered briefly, so a broken path is not asked for again by every render.
  void entry.url.then((url) => {
    entry.value = url;
    if (!url) entry.expires = Date.now() + RETRY_FAILED_MS;
  });
  cache.set(key, entry);
  return entry.url;
}

/** A link already in hand, so a remounted image shows at once instead of flashing a placeholder. */
function cachedUrl(bucket: string, path: string): string | null | undefined {
  const hit = cache.get(keyOf(bucket, path));
  return fresh(hit, MIN_LEFT_MS) ? hit.value : undefined;
}

/** A link to a stored file: undefined while asking, null when there is no path or no file. */
export function useSignedUrl(bucket: string, path: string | undefined): string | null | undefined {
  const [got, setGot] = useState<{ key: string; url: string | null } | null>(null);
  useEffect(() => {
    if (!path) return;
    let live = true;
    signedUrl(bucket, path).then((url) => { if (live) setGot({ key: keyOf(bucket, path), url }); });
    return () => { live = false; };
  }, [bucket, path]);
  if (!path) return null;
  return got?.key === keyOf(bucket, path) ? got.url : cachedUrl(bucket, path);
}
