// Changing an event from the app: the form an event opens as, the calendar_updates row for what was changed, the answer
// to an invitation and the patch shown meanwhile. Pure, so it is unit tested; saving and following the worker are in
// calendar.ts and the New Event dialog.

import type { TablesInsert } from "@messages/db";
import type { CalendarEvent } from "./calendar";
import { dayKey, timeKey } from "./dates";
import { buildEventRow, type EventField, type EventForm } from "./new-items";
import { sameRepeat } from "./recurrence";
import type { Contact as AddressBookContact } from "./types";

/** The calendars whose events can be created, edited, answered and deleted from here. Outlook needs Calendars.ReadWrite, which the worker checks. */
export function canChangeEvents(provider: string | undefined) {
  return provider === "google_calendar" || provider === "icloud_calendar" || provider === "outlook_calendar";
}

/** Your answers to an invitation, as the calendar_updates table spells them. */
export type EventResponse = "accepted" | "tentative" | "declined";
export type UpdateScope = "occurrence" | "series";
export type UpdateInsert = TablesInsert<"calendar_updates">;

/** What the app shows of an event until the worker has made a change: the changed fields, laid over the event. */
export type EventPatch = Partial<Pick<CalendarEvent, "title" | "startsAt" | "endsAt" | "allDay" | "location" | "description" | "attendees" | "response" | "recurrence">>;

export function withPatch(event: CalendarEvent, patch: EventPatch | undefined): CalendarEvent {
  return patch ? { ...event, ...patch, pending: true } : event;
}

/** A change saved but not yet made by the worker: the fields it changes, and whether it reaches the whole series. */
export type PendingEdit = { token: string; id: string; seriesId: string | null; scope: UpdateScope; patch: EventPatch };

/**
 * An event with the saved changes laid over it. A change to a whole series shows on the rest of the series too, except
 * its time, which moves each occurrence by its own amount once the days reload.
 */
export function applyEdits(edits: PendingEdit[], event: CalendarEvent): CalendarEvent {
  let patch: EventPatch | undefined;
  for (const edit of edits) {
    if (edit.id === event.id) patch = { ...patch, ...edit.patch };
    else if (edit.scope === "series" && edit.seriesId && edit.seriesId === event.seriesId) {
      const { startsAt: _s, endsAt: _e, allDay: _a, ...rest } = edit.patch;
      patch = { ...patch, ...rest };
    }
  }
  return withPatch(event, patch);
}

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;

/**
 * An event as the dialog's form holds it, and whether its time can be edited there: the form has one date and a
 * start and end time, so an event over several days (or of no length) keeps the time it has.
 */
export function formOf(event: CalendarEvent): { form: EventForm; editableTime: boolean } {
  const base = { title: event.title, location: event.location ?? "", description: event.description ?? "", guests: event.attendees.map((a) => a.email), sendInvites: true, addMeet: false, repeat: event.recurrence ?? "" };
  if (event.allDay) {
    const days = event.endsAt ? Math.round((Date.parse(`${event.endsAt.slice(0, 10)}T00:00:00Z`) - Date.parse(`${event.startsAt.slice(0, 10)}T00:00:00Z`)) / DAY_MS) : 1;
    return { form: { ...base, date: event.startsAt.slice(0, 10), allDay: true, startTime: "09:00", endTime: "10:00" }, editableTime: days <= 1 };
  }
  const start = new Date(event.startsAt);
  const end = event.endsAt ? new Date(event.endsAt) : new Date(start.getTime() + HOUR_MS);
  const nextDay = dayKey(new Date(start.getFullYear(), start.getMonth(), start.getDate() + 1));
  const form = { ...base, date: dayKey(start), allDay: false, startTime: timeKey(start), endTime: timeKey(end) };
  const sameDay = dayKey(end) === form.date && end > start;
  const overnight = dayKey(end) === nextDay && form.endTime < form.startTime;
  return { form, editableTime: sameDay || overnight };
}

const sameList = (a: string[], b: string[]) => a.length === b.length && [...a].sort().join("\n") === [...b].sort().join("\n");

/**
 * The calendar_updates row for the changes made in the form, with only the fields that changed, and what to show
 * meanwhile. `row` is null when nothing changed. Times are the browser's, as for a new event.
 */
export function buildUpdate(
  event: CalendarEvent,
  form: EventForm,
  scope: UpdateScope,
  timeZone: string,
  contacts: AddressBookContact[],
): { ok: true; row: UpdateInsert | null; patch: EventPatch } | { ok: false; field: EventField; error: string } {
  const initial = formOf(event);
  const accountId = event.accountId ?? "";
  // A time the form cannot show is kept as it is, so it must not be able to stop an edit of something else.
  const safe = (f: EventForm): EventForm => (initial.editableTime ? f : { ...f, allDay: false, startTime: "09:00", endTime: "10:00" });
  const next = buildEventRow(safe(form), accountId, timeZone);
  if (!next.ok) return next;
  const before = buildEventRow(safe(initial.form), accountId, timeZone);

  const row: UpdateInsert = { account_id: accountId, event_id: event.id, kind: "update", scope, send_invites: form.sendInvites };
  const patch: EventPatch = {};
  if (next.row.title !== initial.form.title.trim()) {
    row.title = next.row.title;
    patch.title = next.row.title;
  }
  if ((next.row.location ?? "") !== initial.form.location.trim()) {
    row.location = next.row.location ?? "";
    patch.location = next.row.location;
  }
  if ((next.row.description ?? "") !== initial.form.description.trim()) {
    row.description = next.row.description ?? "";
    patch.description = next.row.description;
  }
  if (initial.editableTime && (!before.ok || before.row.starts_at !== next.row.starts_at || before.row.ends_at !== next.row.ends_at || before.row.all_day !== next.row.all_day)) {
    row.starts_at = next.row.starts_at;
    row.ends_at = next.row.ends_at;
    row.all_day = next.row.all_day;
    row.time_zone = timeZone;
    patch.allDay = next.row.all_day;
    if (next.row.all_day) {
      const day = new Date(`${form.date}T00:00:00Z`);
      patch.startsAt = day.toISOString();
      patch.endsAt = new Date(day.getTime() + DAY_MS).toISOString();
    } else {
      patch.startsAt = next.row.starts_at;
      patch.endsAt = next.row.ends_at;
    }
  }
  if (!sameList(next.row.attendees, initial.form.guests.map((g) => g.toLowerCase()))) {
    row.attendees = next.row.attendees;
    patch.attendees = next.row.attendees.map((email) => {
      const known = event.attendees.find((a) => a.email === email);
      const contact = contacts.find((c) => c.emails.some((e) => e.toLowerCase() === email));
      return known ?? { email, name: contact?.name ?? email, contactId: contact?.id ?? null };
    });
  }
  // A new rule, never none: a series cannot be made a single event from here, and "" leaves a single event as it is.
  if (form.repeat && !sameRepeat(form.repeat, initial.form.repeat ?? "", new Date(event.startsAt))) {
    row.recurrence = form.repeat;
    patch.recurrence = form.repeat;
  }
  const changed = row.title !== undefined || row.location !== undefined || row.description !== undefined || row.starts_at !== undefined || row.attendees !== undefined || row.recurrence !== undefined;
  return { ok: true, row: changed ? row : null, patch };
}

/** The calendar_updates row that answers an invitation: for this event, or for every event in its series. */
export function buildResponse(event: CalendarEvent, response: EventResponse, scope: UpdateScope = "occurrence"): UpdateInsert {
  return { account_id: event.accountId ?? "", event_id: event.id, kind: "rsvp", scope: scope === "series" && event.seriesId ? "series" : "occurrence", response };
}
