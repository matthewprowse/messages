// Local-date helpers shared by the calendar, the task and event forms and the Summary: day keys ("YYYY-MM-DD"),
// day arithmetic and the time-of-day choices. Pure and in the browser's time zone; all-day dates are calendar dates,
// so they are compared as written and never pass through here as instants. One home for what used to be written out
// in calendar.ts, tasks.ts, new-items.ts and both dialogs.

export function pad(n: number) {
  return String(n).padStart(2, "0");
}

/** A local calendar day as "YYYY-MM-DD". */
export function dayKey(d: Date) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** A local time of day as "HH:MM". */
export function timeKey(d: Date) {
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** A "YYYY-MM-DD" as a local date, or undefined when it is not in that shape. "2026-02-31" rolls over: use parseKey to refuse it. */
export function fromDateKey(key: string) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key);
  return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : undefined;
}

/** A "YYYY-MM-DD" known to be well formed (one this module made) as a local date. */
export function fromKey(key: string) {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(y, m - 1, d);
}

/** A "YYYY-MM-DD" from the address bar or a form as a date, or undefined when it is not a real day. */
export function parseKey(key: string | null) {
  if (!key) return undefined;
  const d = fromDateKey(key);
  return d && dayKey(d) === key ? d : undefined;
}

export function startOfDay(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

/** The day `n` days on (or before, when negative), by calendar so a daylight saving change cannot shift it. */
export function addDays(d: Date, n: number) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
}

/** The Monday of the week the day falls in. */
export function startOfWeek(d: Date) {
  return addDays(startOfDay(d), -((d.getDay() + 6) % 7));
}

export function startOfMonth(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

/** A day key moved by `n` days, for all-day dates that are kept as text. */
export function shiftKey(key: string, n: number) {
  return dayKey(addDays(fromKey(key), n));
}

/** Every time of day `step` minutes apart, plus the one already chosen when it falls between them. */
export function timeChoices(current: string, step = 15): string[] {
  const times = Array.from({ length: 1440 / step }, (_, i) => `${pad(Math.floor((i * step) / 60))}:${pad((i * step) % 60)}`);
  return current && !times.includes(current) ? [...times, current].sort() : times;
}
