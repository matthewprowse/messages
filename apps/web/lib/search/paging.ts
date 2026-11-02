// Plans how the message history is read into the index, newest first, a page at a time. Pure: it only decides where the
// next page starts and when to stop; the loader (feed.ts) does the reading.
//
// Two passes share one loop. The catch-up pass starts at the newest message and stops at the first page it already
// holds (everything older was indexed in an earlier session). If an earlier session was cut short, the pass then jumps
// to where that one stopped and carries on backwards (the backfill pass) until it reaches the oldest message.

/** Where a page starts: the oldest message of the page before, by time and then id. */
export interface Cursor {
  sentAt: string;
  id: string;
}

/** What is saved (sealed, beside the index) so a closed tab resumes instead of starting again. */
export interface Saved {
  /** The oldest message indexed so far, going back from the newest. */
  cursor: Cursor | null;
  /** The oldest message has been reached. */
  done: boolean;
}

export interface Pass {
  phase: "catchup" | "backfill";
  /** Where the next page starts; null for the newest. */
  cursor: Cursor | null;
  saved: Saved;
  /** Nothing was indexed before this pass, so the catch-up is the whole build and saves its own progress. */
  fresh: boolean;
}

export interface PageInfo {
  /** The last (oldest) row of the page, or null when it was empty. */
  last: Cursor | null;
  size: number;
  limit: number;
  /** Every row of the page was already in the index. */
  allKnown: boolean;
}

export const NEW_SAVED: Saved = { cursor: null, done: false };

export function startPass(saved: Saved = NEW_SAVED): Pass {
  return { phase: "catchup", cursor: null, saved, fresh: !saved.cursor && !saved.done };
}

/** The pass after reading a page, and whether reading is over. */
export function afterPage(pass: Pass, page: PageInfo): { pass: Pass; finished: boolean } {
  const { saved } = pass;
  // A short page is the end of the history: everything older than the first page ever read has been seen.
  if (page.size < page.limit || !page.last) {
    return { pass: { ...pass, saved: { cursor: saved.cursor ?? page.last, done: true } }, finished: true };
  }
  if (pass.phase === "backfill") {
    return { pass: { ...pass, cursor: page.last, saved: { cursor: page.last, done: false } }, finished: false };
  }
  if (page.allKnown) {
    if (saved.done) return { pass, finished: true };
    // An earlier session stopped part way: skip what is held and carry on from there.
    if (saved.cursor) return { pass: { ...pass, phase: "backfill", cursor: saved.cursor }, finished: false };
  }
  // New messages, or a fresh index: keep going, and note how far back we are unless an earlier session got further.
  return { pass: { ...pass, cursor: page.last, saved: pass.fresh ? { cursor: page.last, done: false } : saved }, finished: false };
}
