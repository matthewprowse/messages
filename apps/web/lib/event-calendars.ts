// Which calendar a new event goes in: the choices for the New Event dialog (every calendar of every connected calendar
// account, learned from the events already stored) and the default each account remembers. Pure apart from the small
// storage functions at the end, which take the storage as a parameter so they can be tested.

/** One calendar an event can be made in. `calendarId` is what the worker files the event under ("primary" when no calendar is known yet). */
export interface CalendarChoice {
  /** accountId and calendarId, the Select's value. */
  key: string;
  accountId: string;
  calendarId: string;
  /** Shown as the choice: the calendar's name, with the account when there are several. */
  label: string;
  isDefault: boolean;
}

export interface StoredCalendar {
  account_id: string;
  calendar_id: string;
  calendar_name: string | null;
}

export interface CalendarAccount {
  id: string;
  label: string;
  detail: string;
}

const READ_ONLY_IDS = [/#holiday@/i, /@holiday\.calendar\.google\.com$/i, /@import\.calendar\.google\.com$/i, /^addressbook#/i, /#contacts@/i, /#weeknum@/i];

/** Calendars that only show things (public holidays, birthdays from contacts, week numbers, subscribed feeds), so an event cannot be made in them. */
export function isReadOnlyCalendar(calendarId: string): boolean {
  return READ_ONLY_IDS.some((re) => re.test(calendarId));
}

export const choiceKey = (accountId: string, calendarId: string) => `${accountId}|${calendarId}`;

/**
 * The calendar an account uses when nothing is remembered: Google's primary calendar is filed under the account's own
 * address, else the one with the most events (Outlook's default calendar, iCloud's main one).
 */
export function guessDefault(account: CalendarAccount, calendars: { calendarId: string; events: number }[]): string {
  const own = calendars.find((c) => c.calendarId.toLowerCase() === account.detail.toLowerCase());
  if (own) return own.calendarId;
  return [...calendars].sort((a, b) => b.events - a.events || a.calendarId.localeCompare(b.calendarId))[0]?.calendarId ?? "primary";
}

/**
 * Every calendar to choose from, accounts in the order given. `remembered` maps an account id to the calendar the person
 * made its default. An account with no stored events yet has one choice, "primary", which the worker resolves.
 */
export function calendarChoices(accounts: CalendarAccount[], stored: StoredCalendar[], remembered: Record<string, string>): CalendarChoice[] {
  const out: CalendarChoice[] = [];
  for (const account of accounts) {
    const byId = new Map<string, { calendarId: string; name: string | null; events: number }>();
    for (const row of stored) {
      if (row.account_id !== account.id || isReadOnlyCalendar(row.calendar_id)) continue;
      const seen = byId.get(row.calendar_id);
      if (seen) seen.events += 1;
      else byId.set(row.calendar_id, { calendarId: row.calendar_id, name: row.calendar_name?.trim() || null, events: 1 });
    }
    const calendars = [...byId.values()];
    const saved = remembered[account.id];
    const chosenDefault = saved && (calendars.some((c) => c.calendarId === saved) || saved === "primary") ? saved : guessDefault(account, calendars);
    const several = accounts.length > 1;
    if (calendars.length === 0) calendars.push({ calendarId: "primary", name: null, events: 0 });
    // Named calendars first by name; unnamed ones (iCloud's urls, Google's ids) last.
    calendars.sort((a, b) => Number(!a.name) - Number(!b.name) || (a.name ?? "").localeCompare(b.name ?? "") || a.calendarId.localeCompare(b.calendarId));
    for (const c of calendars) {
      const name = c.name ?? "Calendar";
      out.push({
        key: choiceKey(account.id, c.calendarId),
        accountId: account.id,
        calendarId: c.calendarId,
        label: several || calendars.length === 1 ? `${name} (${account.detail || account.label})` : name,
        isDefault: c.calendarId === chosenDefault,
      });
    }
  }
  return out;
}

/** The choice a new event opens on: the one asked for if it exists, else the first account's default. */
export function initialChoice(choices: CalendarChoice[], wantedKey: string | null): CalendarChoice | undefined {
  return choices.find((c) => c.key === wantedKey) ?? choices.find((c) => c.isDefault) ?? choices[0];
}

// ---------------------------------------------------------------------------
// Remembering the default. Per person and per browser, so it is kept in the browser's storage; if that is blocked the
// guess above is used and nothing breaks.
// ---------------------------------------------------------------------------

const STORAGE_KEY = "konva:default-calendars";

type Store = Pick<Storage, "getItem" | "setItem">;

/** The remembered default calendar of each account, or nothing when storage is unavailable or holds something else. */
export function readDefaults(storage: Store | null): Record<string, string> {
  try {
    const parsed: unknown = JSON.parse(storage?.getItem(STORAGE_KEY) ?? "{}");
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return Object.fromEntries(Object.entries(parsed).filter((e): e is [string, string] => typeof e[1] === "string"));
  } catch {
    return {};
  }
}

/** Remembers `calendarId` as an account's default. Returns what is remembered now. */
export function writeDefault(storage: Store | null, accountId: string, calendarId: string): Record<string, string> {
  const next = { ...readDefaults(storage), [accountId]: calendarId };
  try {
    storage?.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Storage is full or blocked: the choice lasts until the page is closed.
  }
  return next;
}

/** The browser's local storage, or null where it cannot be reached (private windows, blocked site data). */
export function browserStorage(): Store | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}
