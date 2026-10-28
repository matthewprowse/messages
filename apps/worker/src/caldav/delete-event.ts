// Deleting one occurrence of a repeating event in iCloud: the event's file holds the whole series, so the
// occurrence is taken out by adding an exception (EXDATE) to the series, and by dropping the edited copy of it
// (a VEVENT with its own RECURRENCE-ID) when it was changed. Pure, so it can be unit tested.

import { icsTimestamp, parseLine } from "./ical";

const compact = (iso: string, allDay: boolean) => (allDay ? iso.slice(0, 10).replace(/-/g, "") : iso.replace(/[-:]/g, "").replace(/\.\d{3}/, ""));

/**
 * The exception line for an occurrence: its RECURRENCE-ID as stored (the part of provider_event_id after the
 * "#"), or its start when that is not a form an exception can use.
 */
export function exceptionLine(recurrenceId: string | null, startsAt: string, allDay: boolean): { line: string; instant: number } {
  const instantOf = (value: string) => Date.parse(icsTimestamp({ name: "RECURRENCE-ID", params: {}, value })!.at);
  if (recurrenceId && /^\d{8}T\d{6}Z$/i.test(recurrenceId)) return { line: `EXDATE:${recurrenceId.toUpperCase()}`, instant: instantOf(recurrenceId) };
  if (recurrenceId && /^\d{8}$/.test(recurrenceId)) return { line: `EXDATE;VALUE=DATE:${recurrenceId}`, instant: instantOf(recurrenceId) };
  return { line: allDay ? `EXDATE;VALUE=DATE:${compact(startsAt, true)}` : `EXDATE:${compact(startsAt, false)}`, instant: Date.parse(startsAt) };
}

/**
 * The event's file with one occurrence taken out, or null when there is no series in it to take it out of.
 * recurrenceId is the occurrence's RECURRENCE-ID (null when unknown) and startsAt its start.
 */
export function excludeOccurrence(ics: string, occurrence: { recurrenceId: string | null; startsAt: string; allDay: boolean }): string | null {
  const eol = ics.includes("\r\n") ? "\r\n" : "\n";
  const lines = ics.split(/\r?\n/);
  const { line: exdate, instant } = exceptionLine(occurrence.recurrenceId, occurrence.startsAt, occurrence.allDay);

  // Each VEVENT as [first line, last line].
  const blocks: [number, number][] = [];
  for (let i = 0, from = -1; i < lines.length; i++) {
    const upper = lines[i].toUpperCase();
    if (upper === "BEGIN:VEVENT") from = i;
    else if (upper === "END:VEVENT" && from >= 0) {
      blocks.push([from, i]);
      from = -1;
    }
  }

  // The series is the VEVENT with no RECURRENCE-ID; one that was changed has its own copy that is dropped.
  let master: [number, number] | null = null;
  const drop: [number, number][] = [];
  for (const block of blocks) {
    const own = lines.slice(block[0], block[1] + 1).find((l) => /^RECURRENCE-ID[;:]/i.test(l));
    if (!own) {
      master ??= block;
      continue;
    }
    const at = icsTimestamp(parseLine(own));
    if (at && Date.parse(at.at) === instant) drop.push(block);
  }
  if (!master) return null;

  // The exception goes with the series' other properties, before any alarm.
  let at = master[1];
  for (let i = master[0] + 1; i < master[1]; i++) {
    if (lines[i].toUpperCase().startsWith("BEGIN:")) {
      at = i;
      break;
    }
  }
  const out = lines.slice();
  out.splice(at, 0, exdate);
  // Dropping from the end keeps the earlier positions right; the series' block is before or after, so shift for the line added.
  for (const [from, to] of drop.sort((a, b) => b[0] - a[0])) out.splice(from + (from > at ? 1 : 0), to - from + 1);
  return out.join(eol);
}
