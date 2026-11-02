// An automation's setup as the browser holds it: When (conditions), Read (the fields to pull out) and Do (what to make of them).
// It is stored as one sealed JSON (automations.spec) in the shape the AI worker checks (apps/ai/ai/automations/spec.py), with the
// same limits. Pure: reading, writing, checking and describing a setup, no network.

export const MAX_LIST = 20;
export const MAX_TEXT = 120;
export const MAX_FIELDS = 12;
export const MAX_DESCRIPTION = 200;
export const MAX_TASK_MINUTES = 7 * 24 * 60;

export interface AutomationSpec {
  name: string;
  when: {
    /** An address (has an @) or a domain. */
    senders: string[];
    subject: string[];
    body: string[];
    /** Words in the subject or the body. */
    anywhere: string[];
    /** Email account ids; empty means every email account. */
    accounts: string[];
  };
  read: { fields: { key: string; description: string }[] };
  do: {
    contact: boolean;
    lead: boolean;
    source: string;
    link: boolean;
    task: { title: string; minutes: number } | null;
    draft: boolean;
    urgent: boolean;
  };
}

/** The text of a list typed with commas or one entry a line: trimmed, no repeats (any case), at most MAX_LIST. */
export function splitList(text: string): string[] {
  const out: string[] = [];
  for (const part of text.split(/[\n,]/)) {
    const v = part.replace(/\s+/g, " ").trim().slice(0, MAX_TEXT);
    if (v && !out.some((o) => o.toLowerCase() === v.toLowerCase())) out.push(v);
    if (out.length === MAX_LIST) break;
  }
  return out;
}

const list = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj => (v && typeof v === "object" && !Array.isArray(v) ? (v as Obj) : {});

/** The setup from its stored JSON text, or null when it is not one this version understands. */
export function parseSpec(text: string | null | undefined): AutomationSpec | null {
  let raw: unknown;
  try {
    raw = JSON.parse(text ?? "");
  } catch {
    return null;
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const r = raw as Obj;
  const name = typeof r.name === "string" ? r.name.trim() : "";
  if (!name) return null;
  const w = obj(r.when);
  const d = obj(r.do);
  const fields = Array.isArray(obj(r.read).fields) ? (obj(r.read).fields as unknown[]) : [];
  const t = d.task && typeof d.task === "object" ? obj(d.task) : null;
  const task = t ? { title: String(t.title ?? "").trim(), minutes: typeof t.minutes === "number" && Number.isInteger(t.minutes) ? t.minutes : 5 } : null;
  return {
    name,
    when: { senders: list(w.senders), subject: list(w.subject), body: list(w.body), anywhere: list(w.anywhere), accounts: list(w.accounts) },
    read: { fields: fields.map(obj).filter((f) => typeof f.key === "string").map((f) => ({ key: f.key as string, description: String(f.description ?? "") })) },
    do: {
      contact: d.contact !== false, lead: d.lead !== false, source: typeof d.source === "string" ? d.source : name, link: d.link !== false,
      task: task && task.title ? task : null, draft: d.draft === true, urgent: d.urgent === true,
    },
  };
}

/** The JSON text to seal and store. */
export function specText(spec: AutomationSpec): string {
  return JSON.stringify(spec);
}

/** A field name as the worker's key: lowercase letters, digits and underscores, starting with a letter. */
export function fieldKey(label: string): string {
  const key = label.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  return /^[a-z]/.test(key) ? key.slice(0, 32) : key ? `f_${key}`.slice(0, 32) : "";
}

/** Why a setup cannot be saved, or null. */
export function specProblem(spec: AutomationSpec, custom: boolean): string | null {
  if (!spec.name.trim()) return "Give the automation a name.";
  const w = spec.when;
  if (!w.senders.length && !w.subject.length && !w.body.length && !w.anywhere.length) return "Add at least one condition, or it would match every email.";
  if (custom && spec.do.contact && !spec.read.fields.some((f) => f.key === "email" || f.key === "phone")) return "Read an email address or a phone number, so there is someone to add as a contact.";
  if (spec.do.draft && !spec.read.fields.some((f) => f.key === "email") && custom) return "A reply draft needs the lead's own email address. Add an Email field.";
  if (spec.do.task && (!Number.isInteger(spec.do.task.minutes) || spec.do.task.minutes < 0 || spec.do.task.minutes > MAX_TASK_MINUTES)) return "The task's time must be between 0 minutes and 7 days.";
  if (spec.do.task && !spec.do.contact) return "A task is tied to the contact, so Create Or Update The Contact must be on.";
  return null;
}

/** One line for a card or a row: what it looks for. */
export function whenSummary(spec: AutomationSpec): string {
  const w = spec.when;
  const parts: string[] = [];
  if (w.senders.length) parts.push(`From ${w.senders.join(", ")}`);
  if (w.subject.length) parts.push(`Subject has ${w.subject.join(" or ")}`);
  if (w.body.length) parts.push(`Body has ${w.body.join(" or ")}`);
  if (w.anywhere.length) parts.push(`Mentions ${w.anywhere.join(" or ")}`);
  return parts.join(". ") || "No conditions";
}

/** What it does, one short phrase each. */
export function doSummary(spec: AutomationSpec): string[] {
  const d = spec.do;
  return [
    d.contact ? (d.lead ? "Adds them as a Lead" : "Adds them as a contact") : "",
    d.link ? "Links the email to them" : "",
    d.task ? `Adds the task ${d.task.title}` : "",
    d.draft ? "Writes a reply draft" : "",
    d.urgent ? "Sends an urgent notification" : "",
  ].filter(Boolean);
}
