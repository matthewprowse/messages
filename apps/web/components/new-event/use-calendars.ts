"use client";

// The calendars the New Event dialog offers: learned once from the events already stored (there is no calendar list
// table), with each account's remembered default. Loaded when the dialog first opens and kept for a few minutes.

import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";
import { browserStorage, calendarChoices, readDefaults, writeDefault, type CalendarAccount, type CalendarChoice, type StoredCalendar } from "@/lib/event-calendars";

const TTL = 5 * 60_000; // ms a loaded list is reused
const ROWS = 2000; // the newest events are enough to know which calendars an account has

let cache: { at: number; userKey: string; rows: StoredCalendar[] } | null = null;

async function loadStored(userKey: string): Promise<StoredCalendar[]> {
  if (cache && cache.userKey === userKey && Date.now() - cache.at < TTL) return cache.rows;
  const { data, error } = await supabase.from("calendar_events").select("account_id, calendar_id, calendar_name").order("starts_at", { ascending: false }).limit(ROWS);
  if (error) throw new Error(`Load calendars failed (${error.code})`);
  cache = { at: Date.now(), userKey, rows: data };
  return data;
}

/** The choices for these accounts, and a function that makes a calendar its account's default. A failed load leaves each account's primary calendar. */
export function useCalendars(accounts: CalendarAccount[], open: boolean): { choices: CalendarChoice[]; makeDefault: (accountId: string, calendarId: string) => void } {
  const [stored, setStored] = useState<StoredCalendar[]>([]);
  const [remembered, setRemembered] = useState<Record<string, string>>({});
  const userKey = accounts.map((a) => a.id).sort().join(",");
  useEffect(() => {
    if (!open || !userKey) return;
    let cancelled = false;
    setRemembered(readDefaults(browserStorage()));
    loadStored(userKey)
      .then((rows) => { if (!cancelled) setStored(rows); })
      .catch((err) => console.error(err instanceof Error ? err.message : "Load calendars failed"));
    return () => { cancelled = true; };
  }, [open, userKey]);
  const choices = useMemo(() => calendarChoices(accounts, stored, remembered), [accounts, stored, remembered]);
  const makeDefault = useCallback((accountId: string, calendarId: string) => setRemembered(writeDefault(browserStorage(), accountId, calendarId)), []);
  return { choices, makeDefault };
}
