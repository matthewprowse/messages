// Plain display formatting shared across screens: phone numbers, names, relative times and dates, file sizes. Pure apart
// from reading the clock and loading the phone library once.

import { useSyncExternalStore } from "react";

type ParsePhone = typeof import("libphonenumber-js").parsePhoneNumberFromString;

// The phone library is large, so it loads in its own chunk after the first paint instead of with the app. Until it
// arrives numbers show as they were given; components that format numbers re-render through usePhoneFormatReady.
let parsePhone: ParsePhone | null = null;
let loading = false;
const listeners = new Set<() => void>();

function loadPhoneLibrary() {
  if (parsePhone || loading) return;
  loading = true;
  void import("libphonenumber-js")
    .then((m) => { parsePhone = m.parsePhoneNumberFromString; listeners.forEach((l) => l()); })
    .catch(() => { loading = false; });
}

// Started as soon as this module runs in the browser, in parallel with the rest of the app.
if (typeof window !== "undefined") loadPhoneLibrary();

/**
 * Resolves once phone numbers can be formatted, or after a short wait if the library cannot load. Loaders that bake a
 * formatted number into stored text (data.ts: a WhatsApp chat named by its number) wait on it before mapping, because a
 * name made before the library arrives would stay unformatted until the store reloads.
 */
export function whenPhoneFormatReady(timeoutMs = 3000): Promise<void> {
  if (parsePhone) return Promise.resolve();
  loadPhoneLibrary();
  return new Promise((resolve) => {
    const done = () => { listeners.delete(done); clearTimeout(timer); resolve(); };
    const timer = setTimeout(done, timeoutMs);
    listeners.add(done);
  });
}

/** True once phone numbers can be formatted. Call it in a component that shows formatPhone output so it re-renders then. */
export function usePhoneFormatReady(): boolean {
  return useSyncExternalStore(
    (l) => { listeners.add(l); return () => { listeners.delete(l); }; },
    () => parsePhone !== null,
    () => false,
  );
}

/**
 * A phone number written the way its country writes it in international form: "+27 82 416 0503",
 * "+44 7700 900123", "+1 415 555 0132". Anything that is not a valid number stays as it is, and so does every number
 * for the moment before the phone library has loaded.
 */
export function formatPhone(raw: string): string {
  if (!parsePhone) { loadPhoneLibrary(); return raw; }
  const n = parsePhone(/^\d+$/.test(raw) ? `+${raw}` : raw);
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
