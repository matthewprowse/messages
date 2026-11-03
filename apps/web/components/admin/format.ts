// How Admin writes its numbers, money, times and codes: the formatters every Admin view shares, from the former Analytics
// and Admin pages. Pure: no React, no network.

import type { Stat } from "@messages/analytics/stats";

const NAMES: Record<string, string> = {
  summary: "Summary",
  briefing: "Summary", // the Summary page's address before 27 October 2026
  inbox: "Inbox",
  calendar: "Calendar",
  contacts: "Contacts",
  attachments: "Attachments",
  settings: "Settings",
  home: "Home",
  login: "Sign In",
  whatsapp: "WhatsApp",
  icloud: "iCloud",
  gmail: "Gmail",
  outlook: "Outlook",
  ai: "AI",
  ms: "Milliseconds",
};

/** "needs_reply" as "Needs Reply", and the app's own names for its screens. */
export function nice(code: string): string {
  if (!code) return "None";
  return code
    .split(/[_:.-]+/)
    .filter(Boolean)
    .map((w) => NAMES[w] ?? w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

export const num = (n: number) => new Intl.NumberFormat("en-GB").format(Math.round(n * 10) / 10);
export const percent = (n: number) => `${num(n)}%`;
/** Dollars; under $1 keeps four decimals so a few cents of AI cost does not round to $0.00. */
export const money = (usd: number) => (usd === 0 ? "$0.00" : usd < 1 ? `$${usd.toFixed(4)}` : `$${usd.toFixed(2)}`);
export function seconds(s: number) {
  if (s < 60) return `${Math.round(s)}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m ${Math.round(s % 60)}s`;
  return `${Math.floor(s / 3600)}h ${Math.round((s % 3600) / 60)}m`;
}
/** Milliseconds, or seconds with one decimal from 1000 up. */
export const ms = (v: number) => (v >= 1000 ? `${(v / 1000).toFixed(1)}s` : `${Math.round(v)}ms`);
/** 12400 as "12.4k", for token counts. */
export const compact = (n: number) => new Intl.NumberFormat("en-GB", { notation: "compact", maximumFractionDigits: 1 }).format(n);

/** "2026-10-25" as "25 Oct". The day is a UTC date, so it is read as one. */
export function shortDay(iso: string): string {
  const d = new Date(`${iso.slice(0, 10)}T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
}
/** A moment as "3 Nov, 14:05". */
export const when = (iso: string) => new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
/** A time of day as "14:05", for the Refresh tooltip. */
export const clock = (ms: number) => new Date(ms).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
/** "2026-10" as "Oct 2026". */
export const monthName = (m: string) => new Date(`${m}-01T00:00:00Z`).toLocaleDateString("en-GB", { month: "short", year: "numeric", timeZone: "UTC" });

/** "3 of 10", or "No Data" when the whole is zero. */
export const of = (part: number, whole: number, fmt: (n: number) => string = num) => (whole === 0 ? "No Data" : `${fmt(part)} of ${fmt(whole)}`);
/** Part as a percentage of the whole; 0 when the whole is zero. */
export const share = (part: number, whole: number) => (whole === 0 ? 0 : (part / whole) * 100);

/** Below this many, a percentage is a hint and not an answer: it is flagged wherever one is shown. */
export const SMALL_SAMPLE = 20;
/** Below this many in the period before, a percentage change swings too wildly to mean anything, so counts are shown. */
const SMALL_BEFORE = 20;

/** The change from the period before, as plain words. No colour: a rise is not always good news. */
export function change({ value, prev }: Stat, fmt?: (n: number) => string): string {
  if (value === prev) return "No Change";
  const up = value > prev;
  if (!fmt && prev < SMALL_BEFORE) return `${up ? "Up" : "Down"} From ${num(prev)} To ${num(value)}`;
  if (prev === 0) return "New";
  const d = Math.round(((value - prev) / prev) * 100);
  return d === 0 ? "No Change" : `${up ? "Up" : "Down"} ${Math.abs(d)}%`;
}
