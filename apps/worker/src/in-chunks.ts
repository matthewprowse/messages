// Reads rows for a long list of ids without putting them all in one request URL. supabase-js sends .in() as a GET query
// string, so a few hundred 36 character ids exceed the gateway's limit and the request fails (414/431). The ids are cut
// into slices, each slice is read on its own, and the rows are merged oldest first and cut to the window. A failed
// slice throws with the database's error code (never content), so a poll fails loudly rather than reading part of a queue.

import { chunks } from "./util";

/** Ids per request: 100 ids is about 3.7 KB of URL, well under the smallest limit seen. */
export const IN_CHUNK = 100;

interface Read<T> {
  data: T[] | null;
  error: { code?: string } | null;
}

/** Runs `read` for each slice in turn and returns every row. A failed slice throws with the database's code. */
export async function readByIds<T>(ids: readonly string[], read: (slice: string[]) => PromiseLike<Read<T>>, what: string, size = IN_CHUNK): Promise<T[]> {
  const rows: T[] = [];
  for (const slice of chunks(ids, size)) {
    const result = await read(slice);
    if (result.error) {
      const err = new Error(`${what} failed`) as Error & { code?: string };
      err.code = result.error.code;
      throw err;
    }
    rows.push(...(result.data ?? []));
  }
  return rows;
}

/**
 * Like readByIds for queue reads: the rows of every slice are merged by `created_at` and cut to the oldest `limit`.
 * Each slice is already limited by its own query, so the merged window equals what one query over every id returns.
 */
export async function readQueued<T extends { created_at: string }>(ids: readonly string[], read: (slice: string[]) => PromiseLike<Read<T>>, what: string, limit: number, size = IN_CHUNK): Promise<T[]> {
  const rows = await readByIds(ids, read, what, size);
  return rows.sort((a, b) => a.created_at.localeCompare(b.created_at)).slice(0, limit);
}
