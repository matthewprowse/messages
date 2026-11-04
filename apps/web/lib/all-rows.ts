// Reads every row of a query a page at a time, as the API returns at most 1000 rows per request. Only the page
// function it is given touches the network, so it is tested with fakes (all-rows.test.ts).

import type { PostgrestError } from "@supabase/supabase-js";

const PAGE = 1000; // the most rows the API returns for one request
// Pages asked for together once the first comes back full. Each request costs a round trip (about 250 ms from South
// Africa to Ireland), so a few at once beat one after another. A page past the end comes back empty, so at most
// WINDOW - 1 requests are wasted, and only for a query over 1000 rows.
const WINDOW = 3;

/**
 * Every row of a query, in order. The query must have a stable order so no row is missed. Throws `<label> failed
 * (<code>)` for the first failed page before the end, exactly as reading one page at a time would; a page asked for
 * past the end is ignored, failed or not.
 */
export async function allRows<T>(label: string, page: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: Pick<PostgrestError, "code"> | null }>): Promise<T[]> {
  const data: T[] = [];
  // Most queries fit in one page, so the first is asked for alone; after a full one, WINDOW at a time.
  for (let next = 0, ask = 1; ; next += ask, ask = WINDOW) {
    const round = Array.from({ length: ask }, (_, i) => Promise.resolve(page((next + i) * PAGE, (next + i + 1) * PAGE - 1)));
    // A page left unread after an earlier one ends the query must not surface as an unhandled rejection.
    for (const p of round) p.catch(() => undefined);
    for (const pending of round) {
      const result = await pending;
      if (result.error) throw new Error(`${label} failed (${result.error.code})`);
      data.push(...(result.data ?? []));
      if ((result.data?.length ?? 0) < PAGE) return data;
    }
  }
}
