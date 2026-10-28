// Opening an email file that was left at the mailbox (attachments.not_kept = 'deferred'): the viewer asks the worker to
// fetch it by inserting a row in attachment_fetch_requests, then checks every couple of seconds until the file has a
// stored path, the worker reports an error, or a minute passes. The calls are passed in so this can be tested.

export const FETCH_POLL_MS = 2000;
export const FETCH_GIVE_UP_MS = 60_000;

export const FETCH_TEXT = {
  fetching: "Fetching From Your Mailbox",
  gone: "This File Is No Longer in Your Mailbox.",
  cannotAsk: "The Request Could Not Be Made. Check Your Connection and Try Again.",
  slow: "This Is Taking Longer Than Expected. Try Again in a Moment.",
} as const;

/** A file the worker has not copied yet, and so is fetched when opened. */
export function isDeferredFile(a: { notKept?: string; path?: string }): boolean {
  return a.notKept === "deferred" && !a.path;
}

export type FetchOutcome =
  | { kind: "ready"; path: string; sealed: boolean }
  | { kind: "error"; message: string; retry: boolean };

export interface FileCheck {
  path: string | null;
  sealed: boolean;
  notKept: string | null;
  /** The worker's message on the request row, if it failed. */
  error: string | null;
}

export interface FetchApi {
  /** Makes the request. `again` first removes a failed one. Resolves false when it could not be made. A request that already exists counts as made. */
  request(attachmentId: string, again: boolean): Promise<boolean>;
  check(attachmentId: string): Promise<FileCheck>;
  wait(ms: number): Promise<void>;
  visible(): boolean;
}

/** Asks for the file and waits for it. Stops early (returning null) when `stopped()` turns true. */
export async function fetchDeferredFile(api: FetchApi, attachmentId: string, again: boolean, stopped: () => boolean, pollMs = FETCH_POLL_MS, giveUpMs = FETCH_GIVE_UP_MS): Promise<FetchOutcome | null> {
  const made = await api.request(attachmentId, again).catch(() => false);
  if (stopped()) return null;
  if (!made) return { kind: "error", message: FETCH_TEXT.cannotAsk, retry: true };
  // Only time spent looking counts: a hidden tab pauses the clock instead of giving up.
  let waited = 0;
  for (;;) {
    if (api.visible()) {
      const state = await api.check(attachmentId).catch((): FileCheck | null => null);
      if (stopped()) return null;
      if (state?.path) return { kind: "ready", path: state.path, sealed: state.sealed };
      if (state?.error) return { kind: "error", message: state.error, retry: true };
      if (state?.notKept === "unavailable") return { kind: "error", message: FETCH_TEXT.gone, retry: false };
      if (waited >= giveUpMs) return { kind: "error", message: FETCH_TEXT.slow, retry: true };
      waited += pollMs;
    }
    await api.wait(pollMs);
    if (stopped()) return null;
  }
}
