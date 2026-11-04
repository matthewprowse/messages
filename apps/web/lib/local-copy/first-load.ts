// The first full load from the server when the device copy of the inbox may be on screen. If it fails while the copy
// shows, the copy stays (still marked fromCopy, so nothing acts on it) and the full load is tried again, after a growing
// pause or at once when the app comes back online or into view, until it lands. Only that full load ends the copy; a
// catch-up never does (see "merged" in app-store/reducer.ts). With no copy on screen a failure is passed on, as before.
// Plain: timers and events come in through `sleep`, so the decisions are tested without a browser.

/** First pause before trying again. */
const FIRST_RETRY_MS = 2_000;
/** Longest pause between tries. */
const MAX_RETRY_MS = 60_000;

/** The pause after the given number of failed tries (1 for the first): doubling from FIRST_RETRY_MS, capped at MAX_RETRY_MS. */
export function retryDelayMs(failures: number): number {
  return Math.min(MAX_RETRY_MS, FIRST_RETRY_MS * 2 ** Math.max(0, failures - 1));
}

export interface FirstLoadDeps<T, B> {
  load: () => Promise<T>;
  /** The base for the first try, read when it lands: with the copy in it once the copy showed. */
  firstBase: () => B;
  /** The state now, the base for a retry. It holds the copy, so the load wins over the copy's rows. */
  baseNow: () => B;
  /** Whether the copy is on screen now. */
  showingCopy: () => boolean;
  /** Called once, on the first failure kept behind the copy, to say the list could not be refreshed. */
  onKept: () => void;
  /** Calls done after ms, or sooner when woken (back online, app shown). Returns a function that stops it. */
  sleep: (ms: number, done: () => void) => () => void;
}

/** A running first load: `landed` resolves with the data and the base to merge it against, or rejects when it gave up or was cancelled. */
export interface FirstLoad<T, B> {
  landed: Promise<{ data: T; base: B }>;
  cancel: () => void;
}

export function loadOverCopy<T, B>(deps: FirstLoadDeps<T, B>): FirstLoad<T, B> {
  let cancelled = false;
  let stop = () => {};
  let wake = () => {};
  const gone = () => new Error("cancelled");
  const landed = (async () => {
    for (let failures = 0; ; ) {
      const base = failures === 0 ? undefined : deps.baseNow();
      try {
        const data = await deps.load();
        if (cancelled) throw gone();
        return { data, base: base === undefined ? deps.firstBase() : base };
      } catch (error) {
        if (cancelled || !deps.showingCopy()) throw error;
        if (++failures === 1) deps.onKept();
        await new Promise<void>((resolve) => { wake = resolve; stop = deps.sleep(retryDelayMs(failures), resolve); });
        if (cancelled) throw gone();
      }
    }
  })();
  return { landed, cancel: () => { cancelled = true; stop(); wake(); } };
}
