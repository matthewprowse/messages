// Turns an Outlook event from Microsoft Graph into a calendar_events row, stored the same way as a Google
// event. Pure, so it can be unit tested. Events are read with Prefer: outlook.timezone="UTC", so times
// come back in UTC without a zone suffix.

import type { Json, TablesInsert } from "@messages/db";

export interface GraphDateTime {
  dateTime?: string;
  timeZone?: string;
}

interface GraphEmail {
  name?: string | null;
  address?: string | null;
}

export interface GraphEvent {
  id?: string;
  iCalUId?: string | null;
  subject?: string | null;
  isAllDay?: boolean;
  isCancelled?: boolean;
  start?: GraphDateTime;
  end?: GraphDateTime;
  location?: { displayName?: string | null } | null;
  attendees?: { type?: string; status?: { response?: string } | null; emailAddress?: GraphEmail | null }[];
  organizer?: { emailAddress?: GraphEmail | null } | null;
}

/** Outlook's answers in Google's words, so every calendar's attendees read the same. */
const RESPONSES: Record<string, string> = {
  accepted: "accepted",
  organizer: "accepted",
  tentativelyAccepted: "tentative",
  declined: "declined",
  none: "needsAction",
  notResponded: "needsAction",
};

/**
 * A UTC timestamp from Graph's "2026-10-24T08:00:00.0000000". An all-day event is stored at midnight UTC
 * on its date, with all_day set, like Google's; Outlook keeps all-day events at midnight whatever zone
 * they are read in, so the date part is the day itself.
 */
export function graphTimestamp(time: GraphDateTime | undefined, allDay: boolean): string | null {
  const value = time?.dateTime;
  if (!value || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(value)) return null;
  if (allDay) return `${value.slice(0, 10)}T00:00:00Z`;
  const date = new Date(`${value.slice(0, 19)}Z`);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

/** An Outlook event as it is stored in calendar_events. Null for cancelled events or ones without a start. */
export function storedOutlookEvent(
  event: GraphEvent,
  owner: { userId: string; accountId: string; calendarId: string; selfAddresses: Set<string> },
): TablesInsert<"calendar_events"> | null {
  const allDay = !!event.isAllDay;
  const startsAt = graphTimestamp(event.start, allDay);
  if (!event.id || event.isCancelled || !startsAt) return null;

  const organizer = event.organizer?.emailAddress?.address?.toLowerCase() ?? null;
  const attendees = (event.attendees ?? [])
    .filter((a) => a.emailAddress?.address && a.type !== "resource")
    .map((a) => {
      const email = a.emailAddress!.address!.toLowerCase();
      const response = a.status?.response ?? null;
      return {
        email,
        name: a.emailAddress?.name || null,
        response: response ? (RESPONSES[response] ?? null) : null,
        self: owner.selfAddresses.has(email),
        organizer: email === organizer || response === "organizer",
      };
    });
  // Graph leaves the organizer out of the attendees; Google lists them. Added so both say who it is with.
  if (organizer && !attendees.some((a) => a.email === organizer)) {
    attendees.unshift({
      email: organizer,
      name: event.organizer?.emailAddress?.name || null,
      response: "accepted",
      self: owner.selfAddresses.has(organizer),
      organizer: true,
    });
  }

  return {
    user_id: owner.userId,
    account_id: owner.accountId,
    calendar_id: owner.calendarId,
    provider_event_id: event.id,
    title: event.subject || null,
    starts_at: startsAt,
    ends_at: graphTimestamp(event.end, allDay),
    all_day: allDay,
    location: event.location?.displayName || null,
    attendees: attendees satisfies Json,
  };
}
