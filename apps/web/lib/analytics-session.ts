// The rule for when a usage session starts: a session ends after 30 minutes with nothing recorded. Pure, so the rule is
// tested without a browser; lib/analytics.ts keeps the stored value in localStorage so a reload or a second tab carries
// on the same session instead of starting a new one (a session used to be a page load, which inflated sessions and opens).

export const IDLE_MS = 30 * 60_000;

export interface StoredSession {
  id: string;
  /** When something was last recorded in it, ms since the epoch. */
  at: number;
}

/** The session to use now: the stored one if it was touched within IDLE_MS, else a new one (`fresh`). */
export function nextSession(stored: StoredSession | null, now: number, makeId: () => string): { session: StoredSession; fresh: boolean } {
  if (stored && stored.id && now - stored.at >= 0 && now - stored.at < IDLE_MS) return { session: { id: stored.id, at: now }, fresh: false };
  return { session: { id: makeId(), at: now }, fresh: true };
}

/** A stored value read back as a session, or null when it is missing or damaged. */
export function parseSession(raw: string | null): StoredSession | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as Partial<StoredSession>;
    return typeof v.id === "string" && /^[a-z0-9-]{1,40}$/.test(v.id) && typeof v.at === "number" && Number.isFinite(v.at) ? { id: v.id, at: v.at } : null;
  } catch {
    return null;
  }
}
