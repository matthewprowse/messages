// Guided drafting: the one-tap choices triage offers for a message that needs a decision only you can
// make, and the calendar checks behind an availability question. Pure helpers except loadChoices.
import { FIELD } from "@messages/crypto/fields";

export type ChoiceKind = "accept" | "decline" | "other_time" | "answer";

export interface ChoiceOption {
  /** Button text. */
  label: string;
  /** What you decided, as one first-person sentence the draft says. */
  decision: string;
  kind: ChoiceKind;
}

export interface ReplyChoices {
  /** The time they asked about, as written in the message (local time). */
  asked?: Date;
  /** How long it would take, when the message said. */
  minutes?: number;
  options: ChoiceOption[];
  /** Something the message proposes that belongs in the calendar, for Add to Calendar. */
  plan?: Plan;
}

/** A proposed event as New Event takes it: an all-day plan over one or more days, or a time on one day. */
export interface Plan {
  title: string;
  /** "YYYY-MM-DD", the first day. */
  day: string;
  /** "HH:MM" start, for a timed plan. */
  time?: string;
  /** "HH:MM" end on the same day, when the message gave one. */
  until?: string;
  /** "YYYY-MM-DD", the last day of an all-day plan over several days. */
  endDay?: string;
  place: string;
}

export interface Busy {
  title: string;
  startsAt: string;
  endsAt: string | null;
  allDay: boolean;
}

const KINDS = new Set<ChoiceKind>(["accept", "decline", "other_time", "answer"]);

/** message_ai.reply_choices, opened, as choices to show: null when there are none to offer. */
export function parseChoices(json: string | null | undefined): ReplyChoices | null {
  if (!json) return null;
  let raw: { asked?: unknown; minutes?: unknown; options?: unknown; plan?: unknown };
  try {
    raw = JSON.parse(json);
  } catch {
    return null;
  }
  const options = (Array.isArray(raw.options) ? raw.options : []).filter(
    (o): o is ChoiceOption => !!o && typeof o.label === "string" && typeof o.decision === "string" && KINDS.has(o.kind),
  );
  if (options.length < 2) return null;
  // "2026-10-29T15:00" with no zone is read as local time, which is what the message meant.
  const asked = typeof raw.asked === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(raw.asked) ? new Date(raw.asked) : undefined;
  return {
    asked: asked && !Number.isNaN(asked.getTime()) ? asked : undefined,
    minutes: typeof raw.minutes === "number" && raw.minutes > 0 ? raw.minutes : undefined,
    options,
    plan: parsePlan(raw.plan),
  };
}

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const AT_RE = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})$/;

/**
 * The plan triage found, as New Event takes it, or undefined. A start with a time is a timed event on that day (with
 * its end time when it is the same day); a start with no time is all day, to its last day when there is one.
 */
export function parsePlan(raw: unknown): Plan | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const p = raw as Record<string, unknown>;
  const title = typeof p.title === "string" ? p.title.trim() : "";
  const start = typeof p.start === "string" ? p.start : "";
  const end = typeof p.end === "string" ? p.end : "";
  const place = typeof p.place === "string" ? p.place.trim() : "";
  if (!title) return undefined;
  const at = AT_RE.exec(start);
  if (at) {
    const until = AT_RE.exec(end);
    return { title, day: at[1], time: at[2], until: until && until[1] === at[1] && until[2] > at[2] ? until[2] : undefined, place };
  }
  if (!DAY_RE.test(start)) return undefined;
  return { title, day: start, endDay: DAY_RE.test(end) && end > start ? end : undefined, place };
}

/** The choices for one message, or null: none, not looked at yet, or the column is not there yet. */
export async function loadChoices(messageId: string): Promise<ReplyChoices | null> {
  const [{ supabase }, { open }] = await Promise.all([import("./supabase"), import("./vault")]);
  const { data, error } = await supabase.from("message_ai").select("reply_choices").eq("message_id", messageId).maybeSingle();
  if (error || !data?.reply_choices) return null;
  return parseChoices(await open(FIELD.choices, data.reply_choices));
}

const MINUTE = 60_000;

/** Timed events overlapping start to end. All-day events (holidays, birthdays) do not block a time. */
export function clashes(events: Busy[], start: Date, end: Date): Busy[] {
  return events.filter((e) => {
    if (e.allDay) return false;
    const s = new Date(e.startsAt).getTime();
    const f = e.endsAt ? new Date(e.endsAt).getTime() : s + 30 * MINUTE;
    return s < end.getTime() && f > start.getTime();
  });
}

/**
 * Free times to offer instead: whole hours from 08:00 to 17:00, from the asked day (or today) on, not
 * in the past or clashing with an event, at most two a day so there is a real choice of days.
 */
export function freeSlots(events: Busy[], from: Date, now: Date, minutes = 60, count = 3, days = 7): Date[] {
  const out: Date[] = [];
  const day = new Date(Math.max(from.getTime(), now.getTime()));
  day.setHours(0, 0, 0, 0);
  for (let d = 0; d < days && out.length < count; d++) {
    let today = 0;
    for (let hour = 8; hour <= 17 && today < 2 && out.length < count; hour++) {
      const start = new Date(day.getFullYear(), day.getMonth(), day.getDate() + d, hour);
      if (start.getTime() < now.getTime() + 30 * MINUTE) continue;
      if (clashes(events, start, new Date(start.getTime() + minutes * MINUTE)).length) continue;
      out.push(start);
      today++;
    }
  }
  return out;
}

/** "Thursday 29 October, 15:00". */
export function slotLabel(at: Date): string {
  const day = at.toLocaleDateString("en-ZA", { weekday: "long", day: "numeric", month: "long" });
  const time = at.toLocaleTimeString("en-ZA", { hour: "2-digit", minute: "2-digit", hour12: false });
  return `${day}, ${time}`;
}

/** "Fri 30 Oct, 09:00", short enough for a button. */
export function slotButton(at: Date): string {
  const day = at.toLocaleDateString("en-ZA", { weekday: "short", day: "numeric", month: "short" });
  const time = at.toLocaleTimeString("en-ZA", { hour: "2-digit", minute: "2-digit", hour12: false });
  return `${day}, ${time}`;
}

/** What the draft is told when you pick one of the free times instead of the one asked about. */
export function otherTimeDecision(slot: Date, asked?: Date): string {
  return asked
    ? `I am not free on ${slotLabel(asked)}, but ${slotLabel(slot)} works for me.`
    : `${slotLabel(slot)} works for me.`;
}
