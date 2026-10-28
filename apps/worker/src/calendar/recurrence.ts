// How a repeating event repeats: its rule as iCalendar writes it after "RRULE:" (FREQ=WEEKLY;BYDAY=TU). Stored on
// every occurrence of the series (calendar_events.recurrence), and sent when an event is made or changed to repeat.
// Google keeps it in an event's `recurrence` lines, iCloud in the series' VEVENT. Pure, so it is unit tested.

/** The rules the app sends, as the database checks them on calendar_outbox and calendar_updates. */
const RULE = /^FREQ=(DAILY|WEEKLY|MONTHLY|YEARLY)(;[A-Z]+=[A-Za-z0-9,:+-]+)*$/;

export const BAD_RULE = "This repeat is not one the calendar knows.";
export const SERIES_RULE = "A change to how an event repeats is for all of its events.";

export function validRule(rule: string): boolean {
  return rule.length <= 500 && RULE.test(rule);
}

/** The rule in a list of recurrence lines (Google's `recurrence`), or null when there is none. */
export function ruleOf(lines: string[] | null | undefined): string | null {
  const line = lines?.map((l) => l.trim()).find((l) => /^RRULE:/i.test(l));
  return line ? line.slice(6) || null : null;
}

/** The lines with their rule replaced by this one (or this one added), keeping the rest, such as skipped dates. */
export function withRule(lines: string[] | null | undefined, rule: string): string[] {
  return [`RRULE:${rule}`, ...(lines ?? []).filter((l) => !/^RRULE:/i.test(l.trim()))];
}
