// The one-line "where do I stand with this person" on every contact, worked out from when they last wrote to you and
// when you last wrote to them (contact_last_touch, which leaves out groups, newsletters and notifications). Computed, not
// typed: "Waiting on you since Tuesday", "Waiting on them since 3 Nov", "You last wrote 12 days ago". Pure.

import { startOfDay } from "./dates";

const weekday = new Intl.DateTimeFormat("en-GB", { weekday: "long" });
const shortDate = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short" });

/** Whole calendar days from then to now, so yesterday is 1 whatever the time. */
export function daysSince(iso: string, now: Date): number {
  return Math.round((startOfDay(now).getTime() - startOfDay(new Date(iso)).getTime()) / 86_400_000);
}

/** "today", "yesterday", the weekday for the past week, else "3 Nov". */
export function whenText(iso: string, now: Date): string {
  const days = daysSince(iso, now);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  const d = new Date(iso);
  return days < 7 ? weekday.format(d) : shortDate.format(d);
}

/** "today", "yesterday", "12 days ago", or "3 months ago" once it is over two months. */
export function agoText(iso: string, now: Date): string {
  const days = daysSince(iso, now);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 60) return `${days} days ago`;
  return `${Math.floor(days / 30)} months ago`;
}

/** Days within which your own last message still counts as "waiting on them" rather than just "you last wrote". */
export const WAITING_DAYS = 7;

/**
 * The status under a contact's name, or null when there has been no one-to-one conversation. Their message is the
 * newest: they are waiting on you. Yours is the newest: you are waiting on them for a week, after that it reads as when
 * you last wrote. Timestamps are ISO strings.
 */
export function statusLine(lastInbound: string | null | undefined, lastOutbound: string | null | undefined, now: Date = new Date()): string | null {
  if (!lastInbound && !lastOutbound) return null;
  if (lastInbound && (!lastOutbound || lastInbound >= lastOutbound)) return `Waiting on you since ${whenText(lastInbound, now)}`;
  const out = lastOutbound as string;
  return daysSince(out, now) < WAITING_DAYS ? `Waiting on them since ${whenText(out, now)}` : `You last wrote ${agoText(out, now)}`;
}
