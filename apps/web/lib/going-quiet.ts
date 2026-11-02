// Going Quiet: starred people and clients you have not been in touch with for a while. The list on Contacts and the
// card on the Summary page both read goingQuiet(), so they always agree. Pure: it takes the contact summaries the
// Contacts layout already holds.

import { daysSince } from "./relationship-status";
import { isClient } from "./relationships";

/** The choices for "no contact in", and the one used until the user picks. */
export const QUIET_CHOICES = [14, 30, 60, 90] as const;
export const DEFAULT_QUIET_DAYS = 30;

/** What the selector reads about a contact. ContactSummary has all of it. */
export interface QuietCandidate {
  id: string;
  hidden: boolean;
  isCompany: boolean;
  vip?: boolean;
  relationship?: string | null;
  /** Newest message from them, and newest from you, in one-to-one conversations (contact_last_touch). */
  lastInboundAt?: string | null;
  lastOutboundAt?: string | null;
}

/** The newest time either side wrote, or null when there has been no one-to-one conversation. */
export function lastContactAt(c: Pick<QuietCandidate, "lastInboundAt" | "lastOutboundAt">): string | null {
  const a = c.lastInboundAt ?? null;
  const b = c.lastOutboundAt ?? null;
  return a && b ? (a > b ? a : b) : a ?? b;
}

/** A sensible number of days from a URL value: one of the choices, else the default. */
export function quietDaysOf(value: string | null | undefined): number {
  const n = Number(value);
  return (QUIET_CHOICES as readonly number[]).includes(n) ? n : DEFAULT_QUIET_DAYS;
}

/**
 * Starred people and clients (not hidden, not companies) whose last contact is at least `days` days ago, the longest
 * silence first. Someone you have never written with is not "going quiet", so they are left out.
 */
export function goingQuiet<T extends QuietCandidate>(contacts: T[], days: number = DEFAULT_QUIET_DAYS, now: Date = new Date()): T[] {
  return contacts
    .flatMap((c) => {
      const last = lastContactAt(c);
      return last && !c.hidden && !c.isCompany && (c.vip || isClient(c.relationship)) && daysSince(last, now) >= days ? [{ c, last }] : [];
    })
    .sort((a, b) => a.last.localeCompare(b.last))
    .map((x) => x.c);
}
