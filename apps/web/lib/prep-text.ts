// Pure half of meeting prep and the client card: reading the sealed brief JSON the AI worker writes
// (apps/ai/ai/prep.py), and the daily Refresh allowance. No network, so it is tested on its own.

export type PrepPerson = {
  contactId: string;
  name: string;
  who: string;
  recent: string[];
  promises: string[];
  lastMeeting: string | null;
  asked: string | null;
};

/** How many times a card can be refreshed per contact per day; the database enforces the same number. */
export const REFRESH_CAP = 3;

const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((s): s is string => typeof s === "string" && s.trim() !== "") : []);
const text = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);

/** The people in an opened brief. Anything unreadable gives none, so a bad row shows nothing rather than breaking the page. */
export function parsePrep(value: string | null | undefined): PrepPerson[] {
  if (!value) return [];
  let raw: unknown;
  try {
    raw = JSON.parse(value);
  } catch {
    return [];
  }
  const people = (raw as { people?: unknown } | null)?.people;
  if (!Array.isArray(people)) return [];
  return people.flatMap((p): PrepPerson[] => {
    if (!p || typeof p !== "object") return [];
    const o = p as Record<string, unknown>;
    const name = text(o.name);
    if (!name) return [];
    return [{ contactId: text(o.contact_id) ?? "", name, who: text(o.who) ?? "", recent: strings(o.recent), promises: strings(o.promises), lastMeeting: text(o.last_meeting), asked: text(o.asked) }];
  });
}

/** Refreshes left today for a card row; a row from an earlier day (UTC, like the database) has all of them. */
export function refreshesLeft(row: { refresh_day: string; refresh_count: number } | null, now: Date = new Date()): number {
  if (!row || row.refresh_day !== now.toISOString().slice(0, 10)) return REFRESH_CAP;
  return Math.max(0, REFRESH_CAP - row.refresh_count);
}

/** Whether a Refresh was asked for and the worker has not answered yet. */
export function refreshPending(row: { requested_at: string | null; updated_at: string | null } | null): boolean {
  if (!row?.requested_at) return false;
  return !row.updated_at || Date.parse(row.requested_at) > Date.parse(row.updated_at);
}
