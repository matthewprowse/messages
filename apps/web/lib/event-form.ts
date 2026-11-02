// Pure helpers for the New Event dialog's form: the times offered, reading a "YYYY-MM-DD" field, and the Repeat
// list. Kept out of the component so they can be tested.

import { describeRule, repeatChoices, sameRepeat } from "@/lib/recurrence";

/** Minutes between the times offered. */
export const STEP = 15;

// The Repeat list's values for no repeat, and for a series whose rule is not known yet: a Select item needs a value.
export const NO_REPEAT = "none";
export const UNKNOWN_REPEAT = "unknown";

/** Every time of day STEP minutes apart, plus the one already chosen when it falls between them. */
export function timesWith(value: string) {
  const times = Array.from({ length: 1440 / STEP }, (_, i) => `${String(Math.floor((i * STEP) / 60)).padStart(2, "0")}:${String((i * STEP) % 60).padStart(2, "0")}`);
  return value && !times.includes(value) ? [...times, value].sort() : times;
}

/** A "YYYY-MM-DD" form value as a local date, or undefined when it is not in that shape. */
export function fromDateKey(key: string) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key);
  return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : undefined;
}

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
