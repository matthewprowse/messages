// What scripts/encrypt-calendar.ts seals in the calendar rows stored readable before calendar text was sealed (security
// audit 2026-11-03, H5), and how one row is worked out. Pure, so it is tested without a database.

import { decryptField, encryptField, isCiphertext, type UserKeys } from "@messages/crypto";
import { FIELD, type Field } from "@messages/crypto/fields";

/** text: one column. guests: calendar_events.attendees, the list sealed as one JSON string. list: one address per entry. meta: keys inside provider_meta. */
export type Kind = "text" | "guests" | "list" | "meta";

export interface CalendarColumn {
  column: string;
  kind: Kind;
  field: Field;
  /** For meta: the keys inside the object that are sealed. */
  keys?: string[];
}

export interface CalendarSpec {
  table: "calendar_events" | "calendar_outbox" | "calendar_updates" | "meetings";
  columns: CalendarColumn[];
  /**
   * The column a write is conditional on, besides the ones it changes: updated_at where the table has one, so a row the
   * sync changes mid-run is left for the next run, and status on the queues, which are only sealed once settled.
   */
  guard: "updated_at" | "status";
  /** Queues: only rows in these statuses, which nothing changes any more. */
  settled?: string[];
}

const LINK_KEYS = ["join_url", "meeting_code", "online_meeting_id"];

// Smallest first, so a problem shows up before the large table is touched.
export const CALENDAR_SPECS: CalendarSpec[] = [
  {
    table: "calendar_outbox",
    columns: [
      { column: "title", kind: "text", field: FIELD.eventTitle },
      { column: "description", kind: "text", field: FIELD.eventNotes },
      { column: "location", kind: "text", field: FIELD.eventLocation },
      { column: "attendees", kind: "list", field: FIELD.address },
    ],
    guard: "status",
    settled: ["created", "failed"],
  },
  {
    table: "calendar_updates",
    columns: [
      { column: "title", kind: "text", field: FIELD.eventTitle },
      { column: "description", kind: "text", field: FIELD.eventNotes },
      { column: "location", kind: "text", field: FIELD.eventLocation },
      { column: "attendees", kind: "list", field: FIELD.address },
    ],
    guard: "status",
    settled: ["done", "failed"],
  },
  { table: "meetings", columns: [{ column: "provider_meta", kind: "meta", field: FIELD.eventLink, keys: LINK_KEYS }], guard: "updated_at" },
  {
    table: "calendar_events",
    columns: [
      { column: "title", kind: "text", field: FIELD.eventTitle },
      { column: "location", kind: "text", field: FIELD.eventLocation },
      { column: "description", kind: "text", field: FIELD.eventNotes },
      { column: "calendar_name", kind: "text", field: FIELD.calendarName },
      { column: "conference_url", kind: "text", field: FIELD.eventLink },
      { column: "resource_url", kind: "text", field: FIELD.eventFile },
      { column: "attendees", kind: "guests", field: FIELD.eventGuests },
    ],
    guard: "updated_at",
  },
];

/** One value sealed and checked: it must open back to exactly what was read before anything is written. */
async function sealChecked(keys: UserKeys, field: Field, value: string): Promise<string> {
  const sealed = await encryptField(keys, field, value);
  if ((await decryptField(keys, field, sealed)) !== value) throw new Error("does not round-trip");
  return sealed;
}

/** The new value of one column, or undefined when there is nothing to seal (already sealed, empty or missing). */
export async function sealColumn(keys: UserKeys, column: CalendarColumn, value: unknown): Promise<unknown> {
  switch (column.kind) {
    case "text":
      return typeof value === "string" && value !== "" && !isCiphertext(value) ? sealChecked(keys, column.field, value) : undefined;
    case "guests":
      // An empty list stays [], as the worker writes it.
      return Array.isArray(value) && value.length > 0 ? sealChecked(keys, column.field, JSON.stringify(value)) : undefined;
    case "list": {
      if (!Array.isArray(value)) return undefined;
      const next = await Promise.all(value.map((v) => (typeof v === "string" && v !== "" && !isCiphertext(v) ? sealChecked(keys, column.field, v) : v)));
      return next.some((v, i) => v !== value[i]) ? next : undefined;
    }
    case "meta": {
      if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
      const meta = value as Record<string, unknown>;
      const next = { ...meta };
      let any = false;
      for (const key of column.keys ?? []) {
        const v = meta[key];
        if (typeof v !== "string" || v === "" || isCiphertext(v)) continue;
        next[key] = await sealChecked(keys, column.field, v);
        any = true;
      }
      return any ? next : undefined;
    }
  }
}

export interface CalendarPlan {
  /** The guard column's value as read, so the write lands only if the row has not changed since. */
  guard: unknown;
  set: Record<string, unknown>;
}

/** What to write for one row, or null when everything in it is already sealed. Throws if a value does not round-trip. */
export async function planCalendarRow(keys: UserKeys, spec: CalendarSpec, row: Record<string, unknown>): Promise<CalendarPlan | null> {
  const set: Record<string, unknown> = {};
  for (const column of spec.columns) {
    const next = await sealColumn(keys, column, row[column.column]);
    if (next !== undefined) set[column.column] = next;
  }
  return Object.keys(set).length ? { guard: row[spec.guard], set } : null;
}
