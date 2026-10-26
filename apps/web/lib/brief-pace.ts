// How often Refresh Brief may be used. Kept apart from lib/brief.ts so it needs no database to test.
//
// The cap itself is the database's (a trigger on public.briefs): at most REQUESTS_PER_DAY briefs asked for
// in any 24 hours per user, counted in public.brief_requests, which the app can read. This file only
// reads that log to show how many are left, and keeps a short per-browser cooldown against double clicks.

/** Refresh Brief writes and speaks a whole new brief, which costs money, so it is paced. */
export const REFRESH_COOLDOWN_MS = 60_000;
/** The same number as the database trigger. The trigger decides; this is for showing what is left. */
export const REQUESTS_PER_DAY = 3;
const DAY_MS = 24 * 60 * 60_000;

/** Requests made in the last 24 hours, from brief_requests.requested_at values (ISO timestamps). */
function recent(requestedAt: string[], now: number): number[] {
  return requestedAt.map((at) => Date.parse(at)).filter((t) => Number.isFinite(t) && t > now - DAY_MS && t <= now + 60_000);
}

/** Briefs that may still be asked for now. The first brief of the day counts as a request too. */
export function requestsLeft(requestedAt: string[], now: number): number {
  return Math.max(0, REQUESTS_PER_DAY - recent(requestedAt, now).length);
}

/** When the next request is allowed (epoch ms) once none are left, else null. It is when the oldest of the last 24 hours ages out. */
export function nextRequestAt(requestedAt: string[], now: number): number | null {
  const times = recent(requestedAt, now).sort((a, b) => a - b);
  if (times.length < REQUESTS_PER_DAY) return null;
  return times[times.length - REQUESTS_PER_DAY] + DAY_MS;
}

/** The error the database raises for a fourth request: SQLSTATE 54000, message 'brief_request_limit', detail = next allowed time. */
export function limitReached(error: { code?: string; message?: string; details?: string | null } | null | undefined): { nextAt: string | null } | null {
  if (!error || error.code !== "54000" || error.message !== "brief_request_limit") return null;
  const at = error.details ? Date.parse(error.details) : NaN;
  return { nextAt: Number.isFinite(at) ? new Date(at).toISOString() : null };
}

/** "at 14:05" today, "tomorrow at 09:10" or a weekday further out, in the viewer's own time. */
export function whenAllowed(at: number | string, now: number): string {
  const date = new Date(at);
  const time = date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false });
  const day = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const days = Math.round((day(date) - day(new Date(now))) / DAY_MS);
  if (days <= 0) return `at ${time}`;
  if (days === 1) return `tomorrow at ${time}`;
  return `on ${date.toLocaleDateString([], { weekday: "long" })} at ${time}`;
}

/** Milliseconds until the cooldown since the last refresh ends, 0 when it has. */
export function cooldownWait(last: number | null, now: number): number {
  return last === null ? 0 : Math.max(0, last + REFRESH_COOLDOWN_MS - now);
}

const REFRESH_KEY = "konva.briefRefreshedAt";

/** When this browser last refreshed the brief, for the cooldown. Null without storage or a record. */
export function readLastRefresh(): number | null {
  try {
    const n = Number(localStorage.getItem(REFRESH_KEY));
    return Number.isFinite(n) && n > 0 ? n : null;
  } catch {
    return null;
  }
}

/** Records a refresh made now. Without storage the cooldown lives only as long as the page. */
export function noteRefresh(now: number): number {
  try {
    localStorage.setItem(REFRESH_KEY, String(now));
  } catch {
    // Private window or blocked storage.
  }
  return now;
}
