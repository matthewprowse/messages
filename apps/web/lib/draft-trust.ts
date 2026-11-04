// What the app shows to make a draft trustworthy: the fact guard's report as chips (Found or Check This), the line saying what
// the draft was written from, and the reasons offered with a thumbs down. The report comes from apps/ai/ai/drafts_facts.py.
// Pure: no network, no database.

export interface DraftFact { kind: string; text: string; found: boolean }
export interface DraftReport { facts: DraftFact[]; placeholders: string[]; missing: number }
export interface DraftAudit { messages: number; facts: number; rules: number; replies: number; note: boolean; calendar: boolean }
export type FeedbackReason = "too_formal" | "too_casual" | "too_long" | "too_short" | "wrong_facts" | "wrong_language" | "not_like_me";

/**
 * drafts.status of a pre-draft the AI worker held back because it repeats an amount, account, phone number or address only
 * the sender's newest message gave (migration 20261124160100, apps/ai/ai/drafts_facts.py). Shown to check, never as ready.
 */
export const REVIEW_STATUS = "review";

/** The warning shown with a held draft. */
export const REVIEW_WARNING = "Check This Draft Before Sending: It Repeats Details Only The Sender Gave";

/** The reasons offered after a thumbs down, in the order shown. */
export const FEEDBACK_REASONS: { key: FeedbackReason; label: string }[] = [
  { key: "too_formal", label: "Too Formal" },
  { key: "too_casual", label: "Too Casual" },
  { key: "too_long", label: "Too Long" },
  { key: "too_short", label: "Too Short" },
  { key: "wrong_facts", label: "Wrong Facts" },
  { key: "wrong_language", label: "Wrong Language" },
  { key: "not_like_me", label: "Not Like Me" },
];

/** The report as stored (a JSON string, opened by the vault), or undefined when it is missing or not in the shape. */
export function parseReport(raw: string | null | undefined): DraftReport | undefined {
  if (!raw) return undefined;
  try {
    const r = JSON.parse(raw) as Partial<DraftReport>;
    if (!r || !Array.isArray(r.facts) || !Array.isArray(r.placeholders)) return undefined;
    const facts = r.facts.filter((f): f is DraftFact => !!f && typeof f.text === "string" && typeof f.found === "boolean").map((f) => ({ kind: String(f.kind), text: f.text, found: f.found }));
    return { facts, placeholders: r.placeholders.filter((p): p is string => typeof p === "string"), missing: Number(r.missing) || 0 };
  } catch {
    return undefined;
  }
}

/** The audit as stored (counts only), or undefined. */
export function parseAudit(raw: unknown): DraftAudit | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const a = raw as Record<string, unknown>;
  const n = (v: unknown) => (typeof v === "number" && v > 0 ? Math.floor(v) : 0);
  return { messages: n(a.messages), facts: n(a.facts), rules: n(a.rules), replies: n(a.replies), note: a.note === true, calendar: a.calendar === true };
}

const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** "Based on: last 3 messages, 2 saved facts, your calendar". Empty when there is nothing to say. */
export function auditLine(a: DraftAudit | undefined): string {
  if (!a) return "";
  const parts: string[] = [];
  if (a.messages) parts.push(a.messages === 1 ? "the last message" : `the last ${a.messages} messages`);
  if (a.facts) parts.push(count(a.facts, "saved fact", "saved facts"));
  if (a.note) parts.push("your note about them");
  if (a.rules) parts.push(count(a.rules, "style rule", "style rules"));
  if (a.replies) parts.push(a.replies === 1 ? "1 of your past replies" : `${a.replies} of your past replies`);
  if (a.calendar) parts.push("your calendar");
  if (!parts.length) return "";
  const list = parts.length === 1 ? parts[0] : `${parts.slice(0, -1).join(", ")} and ${parts.at(-1)}`;
  return `Written from ${list}.`;
}

/** What to tell the person when a draft has details to check. Null when everything was found. */
export function checkSummary(r: DraftReport | undefined): string | null {
  if (!r) return null;
  const n = r.facts.filter((f) => !f.found).length + r.placeholders.length;
  return n ? `Check ${count(n, "detail", "details")} before sending` : null;
}
