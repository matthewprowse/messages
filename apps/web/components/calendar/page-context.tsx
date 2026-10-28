"use client";

// The calendar page's shared context (dialogs, selection) and the wide-screen check.


import { createContext, useSyncExternalStore } from "react";
import { type CalendarEvent, type EventResponse } from "@/lib/calendar";
import type { Task } from "@/lib/types";


export const WIDE = "(min-width: 768px)";

/** True from the md breakpoint up, where the page is a split and not one scrolling column. */
export function useWide() {
  return useSyncExternalStore(
    (notify) => {
      const query = window.matchMedia(WIDE);
      query.addEventListener("change", notify);
      return () => query.removeEventListener("change", notify);
    },
    () => window.matchMedia(WIDE).matches,
    () => true,
  );
}

export interface PageContext {
  wide: boolean;
  now: Date;
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
  /** Answers an invitation. The page shows the answer at once while the calendar takes it. */
  answer: (event: CalendarEvent, response: EventResponse) => void;
  /** Opens a task's details. */
  openTask: (id: string) => void;
  /** Where a task is from, such as "Google Tasks". */
  sourceOf: (task: Task) => string | undefined;
}

export const Page = createContext<PageContext>({
  wide: true,
  now: new Date(),
  openKey: null,
  setOpenKey: () => undefined,
  details: new Map(),
  detailsFailed: new Set(),
  askToDelete: () => undefined,
  askToEdit: () => undefined,
  answer: () => undefined,
  openTask: () => undefined,
  sourceOf: () => undefined,
});

