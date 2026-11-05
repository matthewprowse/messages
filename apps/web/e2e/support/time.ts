// Calendar days and times for the made-up data and the tests, in the zone the browsers run in (playwright.config.ts sets
// Africa/Johannesburg, which has no daylight saving), so "today" in the database and "today" on screen are the same day.

export const ZONE = "Africa/Johannesburg";
/** The zone's fixed offset from UTC. */
const OFFSET = "+02:00";

const pad = (n: number) => String(n).padStart(2, "0");

/** The calendar day, "YYYY-MM-DD", `days` from today in the test zone. */
export function dayIn(days = 0, now = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: ZONE, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
  const [y, m, d] = parts.split("-").map(Number);
  const moved = new Date(Date.UTC(y, m - 1, d + days));
  return `${moved.getUTCFullYear()}-${pad(moved.getUTCMonth() + 1)}-${pad(moved.getUTCDate())}`;
}

/** The moment "HH:MM" on the day `days` from today, in the test zone. */
export function at(days: number, time: string, now = new Date()): Date {
  return new Date(`${dayIn(days, now)}T${time}:00${OFFSET}`);
}

/** Midnight UTC of the day `days` from today: how the workers store an all day task or event. */
export function allDay(days: number, now = new Date()): Date {
  return new Date(`${dayIn(days, now)}T00:00:00Z`);
}
