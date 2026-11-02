// Scheduling from a conversation: what New Event starts with when it is opened from a thread, the contact as guest and
// the subject as the title. Pure, so it is unit tested; the button that opens the dialog is components/schedule-button.tsx.

import { MAX_GUESTS } from "./new-items";
import type { Contact, Thread } from "./types";

export interface ScheduleDefaults {
  title: string;
  guests: string[];
}

const PREFIX = /^\s*((re|fw|fwd|aw|sv)\s*:\s*)+/i;

/** A subject without its Re: and Fwd: prefixes, which say nothing about a meeting. */
export function cleanSubject(subject: string | undefined): string {
  return (subject ?? "").replace(PREFIX, "").replace(/\s+/g, " ").trim();
}

/**
 * The title and guests for a new event about this conversation. The title is its subject; a chat with no subject (a
 * WhatsApp one) with one person becomes "Meeting with Name". The guests are the email addresses of the people in it
 * who have one: their first, so nobody is invited twice.
 */
export function scheduleDefaults(thread: Pick<Thread, "subject" | "participantIds">, contacts: Pick<Contact, "id" | "name" | "emails">[]): ScheduleDefaults {
  const people = thread.participantIds.map((id) => contacts.find((c) => c.id === id)).filter((c): c is NonNullable<typeof c> => !!c);
  const guests = [...new Set(people.map((c) => c.emails[0]?.trim().toLowerCase()).filter((e): e is string => !!e))].slice(0, MAX_GUESTS);
  const subject = cleanSubject(thread.subject);
  return { title: subject || (people.length === 1 && people[0].name.trim() ? `Meeting with ${people[0].name.trim()}` : ""), guests };
}
