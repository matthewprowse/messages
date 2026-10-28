// How a repeating event repeats, in words, and the repeat choices the event dialog offers. Rules are iCalendar's
// (FREQ=WEEKLY;BYDAY=TU), as Google and iCloud keep them and calendar_events.recurrence stores them. Pure, so it is
// unit tested.

const DAYS: Record<string, string> = { MO: "Monday", TU: "Tuesday", WE: "Wednesday", TH: "Thursday", FR: "Friday", SA: "Saturday", SU: "Sunday" };
/** The day codes in the order Date.getDay() counts them. */
const CODES = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"];
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const UNITS: Record<string, [string, string]> = { DAILY: ["Day", "Days"], WEEKLY: ["Week", "Weeks"], MONTHLY: ["Month", "Months"], YEARLY: ["Year", "Years"] };
const POSITIONS: Record<string, string> = { "1": "First", "2": "Second", "3": "Third", "4": "Fourth", "-1": "Last" };
const WEEKDAYS = "MO,TU,WE,TH,FR";
/** The parts this describes. A rule with any other (BYSETPOS, BYHOUR and the like) is just "Repeats". */
const KNOWN = new Set(["FREQ", "INTERVAL", "BYDAY", "BYMONTHDAY", "BYMONTH", "COUNT", "UNTIL", "WKST"]);

export const ordinal = (n: number) => {
  const teen = n % 100 >= 11 && n % 100 <= 13;
  return `${n}${teen ? "th" : (["th", "st", "nd", "rd"][n % 10] ?? "th")}`;
};

const listOf = (items: string[]) => (items.length <= 1 ? items.join("") : `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`);

function partsOf(rule: string): Map<string, string> {
  const parts = new Map<string, string>();
  for (const part of rule.replace(/^RRULE:/i, "").split(";")) {
    const [key, value] = part.split("=");
    if (key && value) parts.set(key.trim().toUpperCase(), value.trim().toUpperCase());
  }
  return parts;
}

/** "20261231T235959Z" or "20261231" as "31 December 2026". */
function untilText(value: string): string | null {
  const m = /^(\d{4})(\d{2})(\d{2})/.exec(value);
  const month = m ? MONTHS[Number(m[2]) - 1] : undefined;
  return m && month ? `${Number(m[3])} ${month} ${m[1]}` : null;
}

/**
 * The rule in words, such as "Every Week on Tuesday" or "Every 2 Months on the Last Friday, 6 Times". `start` is the
 * first occurrence, which fills in what a rule leaves to it (a weekly rule with no day repeats on the start's day).
 */
export function describeRule(rule: string, start?: Date): string {
  const parts = partsOf(rule);
  const freq = parts.get("FREQ") ?? "";
  const unit = UNITS[freq];
  if (!unit || [...parts.keys()].some((k) => !KNOWN.has(k))) return "Repeats";
  const interval = Number(parts.get("INTERVAL") ?? 1);
  if (!Number.isInteger(interval) || interval < 1) return "Repeats";
  const byDay = parts.get("BYDAY")?.split(",").filter(Boolean) ?? [];
  const byMonthDay = parts.get("BYMONTHDAY");
  const byMonth = parts.get("BYMONTH");

  let text: string;
  if ((freq === "DAILY" || freq === "WEEKLY") && interval === 1 && [...byDay].sort().join() === WEEKDAYS.split(",").sort().join()) {
    text = "Every Weekday";
  } else {
    text = interval === 1 ? `Every ${unit[0]}` : `Every ${interval} ${unit[1]}`;
    if (freq === "DAILY") {
      if (byDay.length || byMonthDay || byMonth) return "Repeats";
    } else if (freq === "WEEKLY") {
      const days = byDay.length ? byDay : start ? [CODES[start.getDay()]] : [];
      if (days.some((d) => !DAYS[d]) || byMonthDay || byMonth) return "Repeats";
      if (days.length) text += ` on ${listOf(days.map((d) => DAYS[d]))}`;
    } else if (freq === "MONTHLY") {
      if (byMonth) return "Repeats";
      if (byMonthDay) {
        const n = Number(byMonthDay);
        if (n === -1) text += " on the Last Day";
        else if (Number.isInteger(n) && n >= 1 && n <= 31) text += ` on the ${ordinal(n)}`;
        else return "Repeats";
      } else if (byDay.length === 1) {
        const m = /^([+-]?\d)?(MO|TU|WE|TH|FR|SA|SU)$/.exec(byDay[0]);
        const position = m?.[1] ? POSITIONS[m[1].replace("+", "")] : undefined;
        if (!m || !position) return "Repeats";
        text += ` on the ${position} ${DAYS[m[2]]}`;
      } else if (byDay.length > 1) {
        return "Repeats";
      } else if (start) {
        text += ` on the ${ordinal(start.getDate())}`;
      }
    } else {
      const month = byMonth ? Number(byMonth) : undefined;
      const day = byMonthDay ? Number(byMonthDay) : undefined;
      if (byDay.length || (month !== undefined && !MONTHS[month - 1]) || (day !== undefined && !(Number.isInteger(day) && day >= 1 && day <= 31))) return "Repeats";
      if (month && day) text += ` on ${day} ${MONTHS[month - 1]}`;
      else if (!month && !day && start) text += ` on ${start.getDate()} ${MONTHS[start.getMonth()]}`;
      else if (month || day) return "Repeats";
    }
  }

  const count = parts.get("COUNT");
  const until = parts.get("UNTIL");
  if (count) {
    const n = Number(count);
    if (!Number.isInteger(n) || n < 1) return "Repeats";
    text += n === 1 ? ", Once" : `, ${n} Times`;
  } else if (until) {
    const date = untilText(until);
    if (!date) return "Repeats";
    text += `, Until ${date}`;
  }
  return text;
}

/** The same rule however it is written: the parts in any order, and the week start (which changes nothing here) left out. */
export function sameRule(a: string, b: string): boolean {
  const key = (rule: string) => [...partsOf(rule)].filter(([k]) => k !== "WKST").map(([k, v]) => `${k}=${v}`).sort().join(";");
  return key(a) === key(b);
}

/**
 * The same repeat for an event starting at `start`: the same rule, or two that say the same once the start fills in
 * what they leave to it ("FREQ=WEEKLY" from a Tuesday is "FREQ=WEEKLY;BYDAY=TU").
 */
export function sameRepeat(a: string, b: string, start?: Date): boolean {
  if (!a || !b) return !a && !b;
  if (sameRule(a, b)) return true;
  const words = describeRule(a, start);
  return words !== "Repeats" && words === describeRule(b, start);
}

export interface RepeatChoice {
  /** The rule, or "" for an event that does not repeat. */
  value: string;
  label: string;
}

/** What the dialog offers for an event on this date. */
export function repeatChoices(date: Date): RepeatChoice[] {
  const code = CODES[date.getDay()];
  const day = date.getDate();
  return [
    { value: "", label: "Does Not Repeat" },
    { value: "FREQ=DAILY", label: "Every Day" },
    { value: `FREQ=WEEKLY;BYDAY=${WEEKDAYS}`, label: "Every Weekday" },
    { value: `FREQ=WEEKLY;BYDAY=${code}`, label: `Every Week on ${DAYS[code]}` },
    { value: `FREQ=MONTHLY;BYMONTHDAY=${day}`, label: `Every Month on the ${ordinal(day)}` },
    { value: `FREQ=YEARLY;BYMONTH=${date.getMonth() + 1};BYMONTHDAY=${day}`, label: `Every Year on ${day} ${MONTHS[date.getMonth()]}` },
  ];
}
