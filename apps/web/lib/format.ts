import { parsePhoneNumberFromString } from "libphonenumber-js";

/**
 * A phone number written the way its country writes it in international form: "+27 82 416 0503",
 * "+44 7700 900123", "+1 415 555 0132". Anything that is not a valid number stays as it is.
 */
export function formatPhone(raw: string): string {
  const n = parsePhoneNumberFromString(/^\d+$/.test(raw) ? `+${raw}` : raw);
  return n?.isValid() ? n.formatInternational() : raw;
}

/** A name that is really a phone number ("27821234567", "+27 82 123 4567") written the way its country writes it. */
export function niceName(name: string): string {
  return /^\+?[\d\s().-]{7,}$/.test(name) ? formatPhone(name.replace(/[\s().-]/g, "")) : name;
}

// Formatters are built once: a new Intl formatter per call is slow across a long list.
const time = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit" });
const weekday = new Intl.DateTimeFormat("en-GB", { weekday: "long" });
const shortDate = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short" });
const dayMonth = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "long" });
const dayMonthYear = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "long", year: "numeric" });
const fullDay = new Intl.DateTimeFormat("en-GB", { weekday: "long", day: "numeric", month: "long" });

const startOf = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();

/** Whole calendar days from d to now, so yesterday is 1 whatever the time. */
function daysBefore(d: Date, now: Date) {
  return Math.round((startOf(now) - startOf(d)) / 86_400_000);
}

// Today shows the clock time, yesterday says "Yesterday", the past week names the day in full,
// and anything older shows the date.
export function relTime(iso: string, now: Date = new Date()) {
  const d = new Date(iso);
  const days = daysBefore(d, now);
  if (days <= 0) return time.format(d);
  if (days === 1) return "Yesterday";
  if (days < 7) return weekday.format(d);
  return shortDate.format(d);
}

export function timeOf(iso: string) {
  return time.format(new Date(iso));
}

/** "10 October 2026". */
export function fullDate(iso: string) {
  return dayMonthYear.format(new Date(iso));
}

export function longDate(iso: string) {
  // "Tuesday, 27 October": en-GB leaves the comma out.
  const parts = Object.fromEntries(fullDay.formatToParts(new Date(iso)).map((p) => [p.type, p.value]));
  return `${parts.weekday}, ${parts.day} ${parts.month}`;
}

/** The full date and time under each message, such as "15 October, 14:32". Other years add the year. */
export function fullStamp(iso: string, now: Date = new Date()) {
  const d = new Date(iso);
  const date = (d.getFullYear() !== now.getFullYear() ? dayMonthYear : dayMonth).format(d);
  return `${date}, ${time.format(d)}`;
}

/**
 * The label between days in a conversation: "Today", "Yesterday", the weekday within the past week
 * ("Wednesday"), and before that the weekday and date ("Wednesday, 21 October"), with the year when it
 * is not this year.
 */
export function dayLabel(iso: string, now: Date = new Date()) {
  const d = new Date(iso);
  const days = daysBefore(d, now);
  if (days === 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days > 1 && days < 7) return weekday.format(d);
  const date = d.getFullYear() === now.getFullYear() ? dayMonth.format(d) : dayMonthYear.format(d);
  return `${weekday.format(d)}, ${date}`;
}

export function formatSize(bytes: number | null) {
  if (bytes === null) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// Time stamp for list rows and chat messages: just the time today, otherwise the day, a comma
// and the time, such as "Yesterday, 21:10" or "Monday, 14:02".
export function stampOf(iso: string, now: Date = new Date()) {
  const day = relTime(iso, now);
  const t = timeOf(iso);
  return day === t ? t : `${day}, ${t}`;
}
