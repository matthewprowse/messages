// Today's calendar events as the Summary last loaded them, kept in memory so the section is there at once when the
// page is opened again. Decrypted titles live here, so lib/auth.tsx clears it when the session ends.

import type { CalendarEvent } from "./calendar";

let cache: { userId: string; day: string; events: CalendarEvent[] } | null = null;

/** The events cached for this person and day, or undefined when there are none (another person's or another day's do not count). */
export function cachedEvents(userId: string | undefined, day: string): CalendarEvent[] | undefined {
  return cache && cache.userId === userId && cache.day === day ? cache.events : undefined;
}

/** Remembers the events just loaded, replacing any earlier ones. */
export function cacheEvents(userId: string, day: string, events: CalendarEvent[]) {
  cache = { userId, day, events };
}

/** Forgets everything. Called on sign out so no event titles outlive the session. */
export function clearTodaysEvents() {
  cache = null;
}
