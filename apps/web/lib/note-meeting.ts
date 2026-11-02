// An editable note made from a meeting's summary, with no AI call: the summary and action items the AI worker already
// wrote are laid out as markdown, and the note is linked to the meeting's calendar event and to its attendees'
// contacts. Pure, so it runs under node:test.

import { uniqueTargets, type LinkTarget } from "./note-link-map";

export interface MeetingForNote {
  title: string;
  startedAt: string;
  summary: string | null;
  actionItems: string[];
  calendarEventId: string | null;
  people: { name: string; contactId: string | null; isSelf: boolean }[];
}

/** Whether there is a summary or action items to make a note from. */
export const canNoteMeeting = (m: Pick<MeetingForNote, "summary" | "actionItems">) => !!m.summary?.trim() || m.actionItems.length > 0;

/** The title, markdown and links for the note. `when` is the meeting's date as shown to the person, such as "2 Nov 2026". */
export function meetingNote(m: MeetingForNote, when: string): { title: string; body: string; links: LinkTarget[] } {
  const others = m.people.filter((p) => !p.isSelf && p.name.trim());
  const parts = [`${when}${others.length ? ` with ${others.map((p) => p.name.trim()).join(", ")}` : ""}`];
  if (m.summary?.trim()) parts.push(`## Summary\n\n${m.summary.trim()}`);
  if (m.actionItems.length) parts.push(`## Action Items\n\n${m.actionItems.map((a) => `- [ ] ${a.replace(/\s+/g, " ").trim()}`).join("\n")}`);
  const links: LinkTarget[] = [];
  if (m.calendarEventId) links.push({ kind: "event", id: m.calendarEventId });
  for (const p of m.people) if (p.contactId && !p.isSelf) links.push({ kind: "contact", id: p.contactId });
  return { title: m.title.trim() || "Meeting", body: `${parts.join("\n\n")}\n`, links: uniqueTargets(links) };
}
