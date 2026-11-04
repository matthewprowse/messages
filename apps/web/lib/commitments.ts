// Promises found in conversations ("I'll send the quote by Friday", "they will confirm Monday"), as the Summary and the
// open conversation need them. Pure: which promises show where, and how a due date reads. The AI worker writes them
// (apps/ai/ai/commitments.py); loading and ticking them is commitments-io.ts. No React, no database.

/** A promise as the app holds it. dueOn is a calendar day (YYYY-MM-DD) or null when no day was named. */
export interface Commitment {
  id: string;
  threadId: string;
  messageId: string;
  /** me: you promised it. them: the other person did. */
  owner: "me" | "them";
  text: string;
  dueOn: string | null;
  status: "open" | "done";
  snoozedUntil: string | null;
}

/** A promise of yours shows on the Summary once it is due within this many days, or past due. */
export const SOON_DAYS = 2;

const DAY_MS = 86_400_000;

/** The local calendar day as YYYY-MM-DD. */
export function dayOf(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Whole days from one YYYY-MM-DD to another (positive when `to` is later). Counted in UTC, so a clock change never shifts one. */
export function daysBetween(from: string, to: string): number {
  const utc = (s: string) => Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10));
  return Math.round((utc(to) - utc(from)) / DAY_MS);
}

/** Open and not snoozed to a time still ahead. */
export function isActive(c: Commitment, now: number): boolean {
  return c.status === "open" && !(c.snoozedUntil && Date.parse(c.snoozedUntil) > now);
}

export interface Promises { yours: Commitment[]; theirs: Commitment[] }

/** What the Summary's Promises section lists: yours due soon or late, theirs late. Most overdue first, then soonest due. */
export function promisesForSummary(all: Commitment[], now: Date): Promises {
  const today = dayOf(now);
  const byDue = (a: Commitment, b: Commitment) => (a.dueOn ?? "").localeCompare(b.dueOn ?? "");
  const active = all.filter((c) => isActive(c, now.getTime()) && c.dueOn);
  return {
    yours: active.filter((c) => c.owner === "me" && daysBetween(today, c.dueOn!) <= SOON_DAYS).sort(byDue),
    theirs: active.filter((c) => c.owner === "them" && daysBetween(today, c.dueOn!) < 0).sort(byDue),
  };
}

/** A conversation's open promises for the strip above its messages: yours first, then theirs, each by day (no day last). */
export function promisesFor(all: Commitment[], threadId: string): Commitment[] {
  const rank = (c: Commitment) => (c.owner === "me" ? 0 : 1);
  return all
    .filter((c) => c.threadId === threadId && c.status === "open")
    .sort((a, b) => rank(a) - rank(b) || (a.dueOn ?? "9999").localeCompare(b.dueOn ?? "9999"));
}

/** How a due day reads: "Due Today", "Due Tomorrow", "Due Fri 6 Nov", "1 Day Overdue", "3 Days Overdue", "No Date". */
export function dueText(c: Pick<Commitment, "dueOn">, now: Date): string {
  if (!c.dueOn) return "No Date";
  const diff = daysBetween(dayOf(now), c.dueOn);
  if (diff === 0) return "Due Today";
  if (diff === 1) return "Due Tomorrow";
  if (diff < 0) return `${-diff} ${diff === -1 ? "Day" : "Days"} Overdue`;
  const d = new Date(+c.dueOn.slice(0, 4), +c.dueOn.slice(5, 7) - 1, +c.dueOn.slice(8, 10));
  return `Due ${d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" })}`;
}

/**
 * The open promises after one changed (a Realtime row): a done one leaves, an open one replaces its old copy where it
 * stood or, when new or moved to another day, goes in by due day as loadCommitments orders them (soonest, no day last).
 */
export function applyCommitment(all: Commitment[], changed: Commitment): Commitment[] {
  const at = all.findIndex((c) => c.id === changed.id);
  if (changed.status !== "open") return at < 0 ? all : all.filter((c) => c.id !== changed.id);
  if (at >= 0 && all[at].dueOn === changed.dueOn) return all.map((c, i) => (i === at ? changed : c));
  const rest = at >= 0 ? all.filter((c) => c.id !== changed.id) : all;
  const later = (c: Commitment) => changed.dueOn !== null && (c.dueOn === null || c.dueOn > changed.dueOn);
  const i = rest.findIndex(later);
  return i < 0 ? [...rest, changed] : [...rest.slice(0, i), changed, ...rest.slice(i)];
}

/** The open promises without one (its row was deleted). */
export function removeCommitment(all: Commitment[], id: string): Commitment[] {
  return all.some((c) => c.id === id) ? all.filter((c) => c.id !== id) : all;
}
