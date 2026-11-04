"use client";

// The calendar page's shared context (dialogs, selection) and the wide-screen check.


import { createContext } from "react";
import { type CalendarEvent, type EventResponse, type UpdateScope } from "@/lib/calendar";
import type { Provider, Task } from "@/lib/types";

// The wide-screen check now lives in lib/use-wide.ts, shared with the split layouts; re-exported for the calendar's imports.
export { WIDE, useWide } from "@/lib/use-wide";

/**
 * The current time, ticking every minute. Kept apart from the page context so the tick re-renders only what draws the
 * time line and dims past events, not every row, chip and checkbox.
 */
export const Now = createContext<Date>(new Date());

export interface PageContext {
  wide: boolean;
  /** Which event's details are open, as "id|day", so an event shown on several days opens once. */
  openKey: string | null;
  setOpenKey: (key: string | null) => void;
  /** Events with their guests, notes and link, fetched when opened. */
  details: Map<string, CalendarEvent>;
  detailsFailed: Set<string>;
  /** Asks the page to delete an event. The page owns the confirmation. */
  askToDelete: (event: CalendarEvent) => void;
  /** Opens the editor for an event. */
  askToEdit: (event: CalendarEvent) => void;
  /** Answers an invitation, for every event in its series when `scope` says so. The page shows the answer at once while the calendar takes it. */
  answer: (event: CalendarEvent, response: EventResponse, scope?: UpdateScope) => void;
  /** Opens a task's details. */
  openTask: (id: string) => void;
  /** Where a task is from, such as "Google Tasks". */
  sourceOf: (task: Task) => string | undefined;
  /** The provider of the account an event is in, for its row's logo. */
  providerOf: (accountId: string | undefined) => Provider | undefined;
}

export const Page = createContext<PageContext>({
  wide: true,
  openKey: null,
  setOpenKey: () => undefined,
  details: new Map(),
  detailsFailed: new Set(),
  askToDelete: () => undefined,
  askToEdit: () => undefined,
  answer: () => undefined,
  openTask: () => undefined,
  sourceOf: () => undefined,
  providerOf: () => undefined,
});

