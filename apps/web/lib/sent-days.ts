// The empty Conversations page: its greeting, and the heatmap of how many messages you sent through Konva each day, as weeks
// of seven days (Monday first) ending this week. Counts only, never content. Pure, so the grid and the shades are tested.

export interface SentDay {
  /** Local date, YYYY-MM-DD. */
  date: string;
  count: number;
  /** 0 for none, then 1 to 4 by share of the busiest day. */
  level: 0 | 1 | 2 | 3 | 4;
  /** After today: drawn empty so the last week keeps its shape. */
  future: boolean;
}

const pad = (n: number) => String(n).padStart(2, "0");
const dayKey = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

/** The first day of the grid: the Monday `weeks - 1` weeks before this week's Monday. */
export function gridStart(today: Date, weeks: number): Date {
  const start = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  start.setDate(start.getDate() - ((start.getDay() + 6) % 7) - (weeks - 1) * 7);
  return start;
}

function levelOf(count: number, max: number): SentDay["level"] {
  if (count === 0 || max === 0) return 0;
  return Math.min(4, Math.max(1, Math.ceil((count / max) * 4))) as SentDay["level"];
}

/** Columns of weeks, oldest first, each Monday to Sunday. `sentAt` are ISO times; ones outside the grid are ignored. */
export function sentWeeks(sentAt: string[], today: Date, weeks = 26): SentDay[][] {
  const counts = new Map<string, number>();
  for (const at of sentAt) {
    const key = dayKey(new Date(at));
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const todayKey = dayKey(today);
  const day = gridStart(today, weeks);
  const cells: { date: string; count: number; future: boolean }[] = [];
  let past = true;
  for (let i = 0; i < weeks * 7; i++) {
    const date = dayKey(day);
    cells.push({ date, count: past ? counts.get(date) ?? 0 : 0, future: !past });
    if (date === todayKey) past = false;
    day.setDate(day.getDate() + 1);
  }
  const max = Math.max(0, ...cells.map((c) => c.count));
  const out: SentDay[][] = [];
  for (let w = 0; w < weeks; w++) out.push(cells.slice(w * 7, w * 7 + 7).map((c) => ({ ...c, level: levelOf(c.count, max) })));
  return out;
}

/** Messages sent in the grid. */
export function sentTotal(weeks: SentDay[][]): number {
  return weeks.reduce((n, w) => n + w.reduce((m, d) => m + d.count, 0), 0);
}

/** "Good Morning" before noon, "Good Afternoon" until six, then "Good Evening", with the first name when there is one. */
export function greeting(now: Date, name: string): string {
  const h = now.getHours();
  const part = h < 12 ? "Good Morning" : h < 18 ? "Good Afternoon" : "Good Evening";
  const first = name.trim().split(/\s+/)[0];
  return first ? `${part}, ${first}` : part;
}
