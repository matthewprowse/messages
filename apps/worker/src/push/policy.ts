// Decides which conversations earn a push and when. Pure: no network, no database. The planner (plan.ts) asks it
// about every thread with a new message, using the person's own Urgent, Important and Quiet Hours settings.

export interface PushSettings {
  pushUrgent: boolean;
  pushImportant: boolean;
  /** "HH:MM" or "HH:MM:SS" as stored in profiles. */
  quietStart: string;
  quietEnd: string;
  /** IANA zone the quiet hours are read in (profiles.timezone). */
  timezone: string;
}

export type PushKind = "urgent" | "important";

/** The candidate thread, as far as the policy cares. */
export interface PushThread {
  priority: string | null;
  lastFromMe: boolean;
  unreadCount: number;
  status: string;
  junk: boolean;
  lastMessageAt: string | null;
  /** The newest message the sender has already looked at. */
  pushNotifiedAt: string | null;
}

/** Messages older than this are never pushed: an old import or a worker that was off must not replay the past. */
export const FRESH_MS = 30 * 60_000;

function minutesOf(time: string): number | null {
  const m = /^(\d{1,2}):(\d{2})/.exec(time);
  if (!m) return null;
  const h = Number(m[1]), min = Number(m[2]);
  return h > 23 || min > 59 ? null : h * 60 + min;
}

function clock(now: Date, timeZone: string): Intl.DateTimeFormatPart[] {
  return new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(now);
}

/** Minutes since local midnight in `timezone`; an unknown zone falls back to UTC rather than throwing. */
export function localMinutes(now: Date, timezone: string): number {
  let parts: Intl.DateTimeFormatPart[];
  try { parts = clock(now, timezone); } catch { parts = clock(now, "UTC"); }
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
  return get("hour") * 60 + get("minute");
}

/** True inside quiet hours. A window that runs past midnight (22:00 to 07:30) is handled; equal times mean no quiet hours. */
export function inQuietHours(now: Date, s: Pick<PushSettings, "quietStart" | "quietEnd" | "timezone">): boolean {
  const start = minutesOf(s.quietStart), end = minutesOf(s.quietEnd);
  if (start === null || end === null || start === end) return false;
  const at = localMinutes(now, s.timezone);
  return start < end ? at >= start && at < end : at >= start || at < end;
}

/** Which kind of push a thread is, or null when it is not one that can notify at all. */
export function pushKind(t: PushThread): PushKind | null {
  if (t.status !== "inbox" || t.junk || t.lastFromMe || t.unreadCount <= 0) return null;
  return t.priority === "urgent" || t.priority === "important" ? t.priority : null;
}

/** The thread has a message the sender has not looked at yet, and it is recent. */
export function isNewMessage(t: PushThread, now: Date): boolean {
  if (!t.lastMessageAt) return false;
  const last = Date.parse(t.lastMessageAt);
  if (!Number.isFinite(last) || now.getTime() - last > FRESH_MS) return false;
  return !t.pushNotifiedAt || Date.parse(t.pushNotifiedAt) < last;
}

/** Whether the person's settings let this kind through right now. Urgent ignores quiet hours; Important respects them. */
export function allowedNow(kind: PushKind, s: PushSettings, now: Date): boolean {
  if (kind === "urgent") return s.pushUrgent;
  return s.pushImportant && !inQuietHours(now, s);
}
