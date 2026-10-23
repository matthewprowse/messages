import type { Account, Contact, Thread } from "./types";
import { isEmail } from "./send-from";

// Pure helpers for starting something new from the New menu: a WhatsApp chat with a phone number, and
// a Google Calendar event. The dialogs use these; the database and the worker check the same limits.

// ---------------------------------------------------------------------------
// Phone numbers
// ---------------------------------------------------------------------------

/** E.164, as the outbox insert policy checks it: a plus, then 7 to 15 digits, not starting with 0. */
const E164 = /^\+[1-9][0-9]{6,14}$/;
export const PHONE_HINT = "Enter one phone number with its country code, like +44 7700 900123.";
const FALLBACK_COUNTRY = "27"; // South Africa, when your own WhatsApp number does not say

export function isE164(value: string) {
  return E164.test(value);
}

// Every two-digit country calling code. 1 and 7 are the only one-digit codes; all others have three.
const TWO_DIGIT = new Set([
  "20", "27", "30", "31", "32", "33", "34", "36", "39", "40", "41", "43", "44", "45", "46", "47", "48", "49",
  "51", "52", "53", "54", "55", "56", "57", "58", "60", "61", "62", "63", "64", "65", "66",
  "81", "82", "84", "86", "90", "91", "92", "93", "94", "95", "98",
]);

/** The country calling code of an E.164 number, without the plus. */
export function countryCodeOf(e164: string): string | null {
  if (!isE164(e164)) return null;
  const digits = e164.slice(1);
  if (digits[0] === "1" || digits[0] === "7") return digits[0];
  return TWO_DIGIT.has(digits.slice(0, 2)) ? digits.slice(0, 2) : digits.slice(0, 3);
}

/** The country a number typed without one belongs to: that of your own WhatsApp number, else South Africa. */
export function defaultCountryCode(accounts: Pick<Account, "provider" | "detail">[]): string {
  for (const a of accounts) {
    if (a.provider !== "whatsapp") continue;
    const own = normalisePhone(a.detail, FALLBACK_COUNTRY);
    const code = own && countryCodeOf(own);
    if (code) return code;
  }
  return FALLBACK_COUNTRY;
}

/**
 * A typed number in E.164 form, or null when it cannot be one. Spaces, dashes, dots and brackets are
 * ignored. "+" or "00" starts an international number; a leading 0 is the national trunk prefix and is
 * replaced by the country code; any other number is taken as national unless it already starts with
 * the country code and is long enough to include it.
 */
export function normalisePhone(input: string, countryCode: string): string | null {
  const raw = input.trim();
  if (!raw || /[^\d\s+().\-/]/.test(raw)) return null;
  if (raw.indexOf("+") > 0 || (raw.match(/\+/g) ?? []).length > 1) return null;
  const digits = raw.replace(/\D/g, "");
  if (!digits) return null;
  let out: string;
  if (raw.startsWith("+")) out = `+${digits}`;
  else if (digits.startsWith("00")) out = `+${digits.slice(2)}`;
  else if (digits.startsWith("0")) out = `+${countryCode}${digits.slice(1)}`;
  else if (digits.startsWith(countryCode) && digits.length >= countryCode.length + 9) out = `+${digits}`;
  else out = `+${countryCode}${digits}`;
  return isE164(out) ? out : null;
}

/**
 * The one-to-one WhatsApp chat already open with this number, newest first, if there is one. phonesOf
 * also finds chats WhatsApp keys by a privacy ID, through the number saved for the person in them.
 */
export function existingChat<T extends Pick<Thread, "id" | "channel" | "isGroup" | "fallbackName" | "lastMessageAt" | "accountId"> & Partial<Pick<Thread, "participantIds">>>(
  threads: T[], number: string, accountId?: string, phonesOf?: (contactId: string) => string[] | undefined,
): T | undefined {
  let best: T | undefined;
  for (const t of threads) {
    if (t.channel !== "whatsapp" || t.isGroup) continue;
    if (t.fallbackName !== number && !(phonesOf && t.participantIds?.some((id) => phonesOf(id)?.includes(number)))) continue;
    if (accountId && t.accountId && t.accountId !== accountId) continue;
    if (!best || t.lastMessageAt > best.lastMessageAt) best = t;
  }
  return best;
}

/** A contact's numbers that are already in E.164 form, which is how WhatsApp and the address book store them. */
export function phonesOf(contact: Pick<Contact, "phones">): string[] {
  return [...new Set(contact.phones.filter(isE164))];
}

/** Contacts with a phone number whose name or number matches every word typed, best known first. */
export function searchPhoneContacts(contacts: Contact[], query: string, limit = 6): { contact: Contact; phone: string }[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];
  const out: { contact: Contact; phone: string }[] = [];
  for (const c of contacts) {
    const phones = phonesOf(c);
    if (phones.length === 0) continue;
    for (const phone of phones) {
      const hay = `${c.name} ${phone}`.toLowerCase();
      const ok = words.every((w) => hay.includes(w) || (/^[\d+]+$/.test(w) && phone.includes(w.replace(/^\+?0/, ""))));
      if (ok) out.push({ contact: c, phone });
    }
    if (out.length >= limit * 2) break;
  }
  return out.slice(0, limit);
}

/** Contacts with an email address matching every word typed, leaving out addresses already added. */
export function searchEmailContacts(contacts: Contact[], query: string, taken: string[], limit = 6): { contact: Contact; email: string }[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];
  const skip = new Set(taken.map((t) => t.toLowerCase()));
  const out: { contact: Contact; email: string }[] = [];
  for (const c of contacts) {
    for (const email of c.emails) {
      const lower = email.toLowerCase();
      if (skip.has(lower)) continue;
      if (words.every((w) => `${c.name} ${lower}`.toLowerCase().includes(w))) out.push({ contact: c, email: lower });
    }
    if (out.length >= limit) break;
  }
  return out.slice(0, limit);
}

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

export const MAX_GUESTS = 50;
export const MAX_TITLE = 300;
export const MAX_LOCATION = 500;
export const MAX_DESCRIPTION = 8000;
export const RECONNECT_MESSAGE = "Reconnect Google to allow creating events. Run pnpm connect:google.";

export interface EventForm {
  title: string;
  /** "YYYY-MM-DD", a local date. */
  date: string;
  allDay: boolean;
  /** "HH:MM", local times. An end earlier than the start ends the next day. */
  startTime: string;
  endTime: string;
  location: string;
  description: string;
  guests: string[];
  sendInvites: boolean;
  addMeet: boolean;
}

export interface CalendarOutboxInsert {
  account_id: string;
  title: string;
  description: string | null;
  location: string | null;
  starts_at: string;
  ends_at: string;
  all_day: boolean;
  time_zone: string;
  attendees: string[];
  send_invites: boolean;
  add_meet: boolean;
}

function pad(n: number) {
  return String(n).padStart(2, "0");
}

export function dateKey(d: Date) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function timeKey(d: Date) {
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function parseDate(date: string) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return dateKey(d) === date ? d : null;
}

function parseTime(time: string) {
  const m = /^(\d{2}):(\d{2})$/.exec(time);
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  return h < 24 && min < 60 ? h * 60 + min : null;
}

/**
 * The times a new event starts with: the next full hour, one hour long. On a day other than today the
 * same hour is used on that day. At 23:xx today the event moves to tomorrow at midnight.
 */
export function defaultEventTimes(now: Date, day?: string): { date: string; startTime: string; endTime: string } {
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate(), now.getHours() + 1);
  const end = new Date(start.getFullYear(), start.getMonth(), start.getDate(), start.getHours() + 1);
  const date = day && parseDate(day) && day !== dateKey(now) ? day : dateKey(start);
  return { date, startTime: timeKey(start), endTime: timeKey(end) };
}

/** The end time after the start moves, keeping the length of the event. */
export function shiftEnd(oldStart: string, oldEnd: string, newStart: string): string {
  const a = parseTime(oldStart);
  const b = parseTime(oldEnd);
  const c = parseTime(newStart);
  if (a === null || b === null || c === null) return oldEnd;
  const length = (b - a + 1440) % 1440 || 60;
  const end = (c + length) % 1440;
  return `${pad(Math.floor(end / 60))}:${pad(end % 60)}`;
}

/** True when the end time is earlier than the start, so the event runs past midnight. */
export function endsNextDay(form: Pick<EventForm, "allDay" | "startTime" | "endTime">) {
  const a = parseTime(form.startTime);
  const b = parseTime(form.endTime);
  return !form.allDay && a !== null && b !== null && b < a;
}

/** Guest addresses as typed: split on commas, semicolons and spaces, lowercased, no repeats. */
export function parseGuests(text: string): { valid: string[]; invalid: string[] } {
  const parts = text.split(/[\s,;]+/).map((p) => p.trim().replace(/^<|>$/g, "")).filter(Boolean);
  const valid: string[] = [];
  const invalid: string[] = [];
  for (const p of parts) {
    if (isEmail(p)) {
      const lower = p.toLowerCase();
      if (!valid.includes(lower)) valid.push(lower);
    } else invalid.push(p);
  }
  return { valid, invalid };
}

export type EventField = "title" | "date" | "time" | "location" | "description" | "guests";

/**
 * The calendar_outbox row for an event, or the first thing to fix. Times are the browser's local
 * times; time_zone tells the worker which zone they are in. An all-day event runs from midnight on its
 * date to midnight the next day, and the worker sends it to Google as dates with the end excluded.
 */
export function buildEventRow(
  form: EventForm,
  accountId: string,
  timeZone: string,
): { ok: true; row: CalendarOutboxInsert } | { ok: false; field: EventField; error: string } {
  const title = form.title.trim();
  if (!title) return { ok: false, field: "title", error: "Add a title." };
  if (title.length > MAX_TITLE) return { ok: false, field: "title", error: `Keep the title to ${MAX_TITLE} characters or fewer.` };
  const day = parseDate(form.date);
  if (!day) return { ok: false, field: "date", error: "Choose a date." };

  let start: Date;
  let end: Date;
  if (form.allDay) {
    start = day;
    end = new Date(day.getFullYear(), day.getMonth(), day.getDate() + 1);
  } else {
    const a = parseTime(form.startTime);
    const b = parseTime(form.endTime);
    if (a === null || b === null) return { ok: false, field: "time", error: "Choose a start and end time." };
    if (a === b) return { ok: false, field: "time", error: "End the event after it starts." };
    start = new Date(day.getFullYear(), day.getMonth(), day.getDate(), Math.floor(a / 60), a % 60);
    end = new Date(day.getFullYear(), day.getMonth(), day.getDate() + (b < a ? 1 : 0), Math.floor(b / 60), b % 60);
  }

  const location = form.location.trim();
  if (location.length > MAX_LOCATION) return { ok: false, field: "location", error: `Keep the location to ${MAX_LOCATION} characters or fewer.` };
  const description = form.description.trim();
  if (description.length > MAX_DESCRIPTION) return { ok: false, field: "description", error: `Keep the description to ${MAX_DESCRIPTION} characters or fewer.` };

  const guests = [...new Set(form.guests.map((g) => g.trim().toLowerCase()).filter(Boolean))];
  const bad = guests.find((g) => !isEmail(g));
  if (bad) return { ok: false, field: "guests", error: `Check ${bad}.` };
  if (guests.length > MAX_GUESTS) return { ok: false, field: "guests", error: `Invite ${MAX_GUESTS} people or fewer.` };
  if (!timeZone) return { ok: false, field: "time", error: "Your time zone could not be found." };

  return {
    ok: true,
    row: {
      account_id: accountId,
      title,
      description: description || null,
      location: location || null,
      starts_at: start.toISOString(),
      ends_at: end.toISOString(),
      all_day: form.allDay,
      time_zone: timeZone,
      attendees: guests,
      send_invites: form.sendInvites,
      add_meet: form.addMeet,
    },
  };
}

/** True when a failed event needs Google to be connected again with permission to create events. */
export function needsReconnect(error: string | null | undefined) {
  return !!error && /reconnect google/i.test(error);
}

/** The linked WhatsApp account that can send, if any. */
export function linkedAccount<T extends { provider: string; status: string }>(accounts: T[]): T | undefined {
  return accounts.find((a) => a.provider === "whatsapp" && (a.status === "connected" || a.status === "syncing"));
}

/** True when a WhatsApp account is linked and can send. */
export function whatsappLinked(accounts: { provider: string; status: string }[]) {
  return !!linkedAccount(accounts);
}
