// When your sent messages went out, as the Conversations home last loaded them for its heatmap, kept in memory so the
// heatmap is there at once on the next visit while a fresh read runs underneath. Times only, never content; still the
// signed-in person's, so lib/auth.tsx clears it when the session ends.

let cache: { userId: string; day: string; times: string[] } | null = null;

/** The times cached for this person and day, or undefined (another person's or another day's do not count). */
export function cachedSentTimes(userId: string | undefined, day: string): string[] | undefined {
  return cache && cache.userId === userId && cache.day === day ? cache.times : undefined;
}

/** Remembers the times just loaded, replacing any earlier ones. */
export function cacheSentTimes(userId: string, day: string, times: string[]) {
  cache = { userId, day, times };
}

/** Forgets everything. Called on sign out. */
export function clearSentTimes() {
  cache = null;
}
