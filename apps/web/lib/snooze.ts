// Snooze and Remind If No Reply, as pure date and state rules: the times the menus offer, whether a conversation is
// hidden right now, and which mark (Snoozed, Follow Up) it wears once its time has passed. No React, no database.

import type { Thread } from "./types";

/** The hour a snoozed conversation comes back at when only a day is chosen. */
export const MORNING_HOUR = 8;
/** Later Today is only offered before this hour (it comes back at LATER_HOUR), so it is never a few minutes away. */
const LATER_CUTOFF_HOUR = 15;
const LATER_HOUR = 18;
/** A conversation that came back from a plain snooze wears the Snoozed mark for this long. */
export const SNOOZED_MARK_HOURS = 24;
/** One that came back from Remind If No Reply wears Follow Up until it is answered, or this long has passed. */
export const FOLLOW_UP_MARK_DAYS = 7;

export interface SnoozeChoice {
  key: string;
  label: string;
  at: Date;
}

const at = (base: Date, addDays: number, hour = MORNING_HOUR) => new Date(base.getFullYear(), base.getMonth(), base.getDate() + addDays, hour, 0, 0, 0);

/** Tomorrow at 08:00: what Done for Now on the Summary snoozes to. */
export function tomorrowMorning(now: Date): Date {
  return at(now, 1);
}

/** The ready-made times for Snooze. Later Today and This Weekend are left out when they would be too soon or already here. */
export function snoozeChoices(now: Date): SnoozeChoice[] {
  const out: SnoozeChoice[] = [];
  if (now.getHours() < LATER_CUTOFF_HOUR) out.push({ key: "later", label: "Later Today", at: at(now, 0, LATER_HOUR) });
  out.push({ key: "tomorrow", label: "Tomorrow", at: tomorrowMorning(now) });
  const day = now.getDay(); // 0 is Sunday
  // Saturday morning, unless it already is the weekend.
  if (day >= 1 && day <= 5) out.push({ key: "weekend", label: "This Weekend", at: at(now, 6 - day) });
  // The next Monday: a full week away when today is Monday, tomorrow when today is Sunday.
  out.push({ key: "week", label: "Next Week", at: at(now, (8 - day) % 7 || 7) });
  return out;
}

/** The ready-made waits for Remind Me If No Reply: 1, 3 or 7 days, each at 08:00. */
export function reminderChoices(now: Date): SnoozeChoice[] {
  return [1, 3, 7].map((d) => ({ key: `${d}d`, label: d === 1 ? "In 1 Day" : `In ${d} Days`, at: at(now, d) }));
}

/** A picked calendar day as a time: 08:00 that day. Today gives the next full hour instead, so it is never in the past. */
export function pickedDay(day: Date, now: Date): Date {
  const sameDay = day.getFullYear() === now.getFullYear() && day.getMonth() === now.getMonth() && day.getDate() === now.getDate();
  if (sameDay) return new Date(now.getFullYear(), now.getMonth(), now.getDate(), now.getHours() + 1, 0, 0, 0);
  return new Date(day.getFullYear(), day.getMonth(), day.getDate(), MORNING_HOUR, 0, 0, 0);
}

type Snoozable = Pick<Thread, "snoozedUntil" | "snoozeKind">;

/** Hidden from Inbox and Summary right now: the return time is still ahead. */
export function isSnoozed(t: Snoozable, now: number = Date.now()): boolean {
  return !!t.snoozedUntil && Date.parse(t.snoozedUntil) > now;
}

/** The mark a returned conversation wears. A plain snooze says Snoozed briefly; a reminder says Follow Up until answered. */
export type SnoozeMark = "snoozed" | "follow_up";
export function snoozeMark(t: Snoozable & Pick<Thread, "lastFromMe">, now: number = Date.now()): SnoozeMark | null {
  if (!t.snoozedUntil) return null;
  const since = now - Date.parse(t.snoozedUntil);
  if (since < 0) return null;
  // A reminder still set after an inbound message is one the AI worker raised for a promise of theirs that passed its day
  // (a reply after the reminder clears it in the database), so it wears Follow Up whoever wrote last.
  if (t.snoozeKind === "reminder") return since <= FOLLOW_UP_MARK_DAYS * 86_400_000 ? "follow_up" : null;
  return since <= SNOOZED_MARK_HOURS * 3_600_000 ? "snoozed" : null;
}

/** The earliest return time still ahead, for scheduling the next redraw; undefined when nothing is snoozed. */
export function nextReturn(threads: Snoozable[], now: number = Date.now()): number | undefined {
  let next: number | undefined;
  for (const t of threads) {
    const due = t.snoozedUntil ? Date.parse(t.snoozedUntil) : NaN;
    if (due > now && (next === undefined || due < next)) next = due;
  }
  return next;
}

/** Where a snoozed conversation returns, in words: "Tomorrow, 08:00", "Mon, 23 Nov, 08:00". */
export function returnText(iso: string, now: Date = new Date()): string {
  const d = new Date(iso);
  const time = d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
  const days = Math.round((new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime() - new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()) / 86_400_000);
  if (days === 0) return `Today, ${time}`;
  if (days === 1) return `Tomorrow, ${time}`;
  return `${d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" })}, ${time}`;
}
