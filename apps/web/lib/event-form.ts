// Pure helpers for the New Event dialog's form: the minutes between the times offered and the Repeat list. Kept out of the component so they can be tested.

import { fromDateKey } from "@/lib/dates";
import { describeRule, repeatChoices, sameRepeat } from "@/lib/recurrence";

/** Minutes between the times offered. */
export const STEP = 15;

// The Repeat list's values for no repeat, and for a series whose rule is not known yet: a Select item needs a value.
export const NO_REPEAT = "none";
export const UNKNOWN_REPEAT = "unknown";

/**
 * The Repeat list for the chosen date, with the event's own rule added when it is none of the choices. A series whose
 * rule has not been read yet shows that it repeats until one is picked.
 */
export function repeatOptionsFor(date: string, repeat: string, repeating: boolean) {
  const start = fromDateKey(date);
  const options: { value: string; label: string }[] = repeatChoices(start ?? new Date()).map((c) => ({ value: c.value || NO_REPEAT, label: c.label }));
  if (repeat && !options.some((o) => sameRepeat(o.value, repeat, start))) {
    const words = describeRule(repeat, start);
    options.push({ value: repeat, label: words === "Repeats" ? "Custom Schedule" : `Custom: ${words}` });
  }
  if (repeating && !repeat) options.push({ value: UNKNOWN_REPEAT, label: "Repeats" });
  return options;
}

/** The Select value for the current rule: the matching choice, the rule itself, or the none and unknown markers. */
export function repeatSelectValue(options: { value: string }[], date: string, repeat: string, repeating: boolean) {
  if (repeat) return options.find((o) => sameRepeat(o.value, repeat, fromDateKey(date)))?.value ?? repeat;
  return repeating ? UNKNOWN_REPEAT : NO_REPEAT;
}
