// What product analytics may record. Every event is a name and a few small values: numbers, yes/no,
// plain code words and lists of them. Never text from a message, a name, an address, a number or
// anything typed. The database refuses anything else too (supabase/migrations/..._product_analytics.sql).

export type Size = "phone" | "tablet" | "desktop";
export type Channel = "email" | "whatsapp" | "linkedin" | "instagram" | "teams" | "zoom" | "google_chat";

/** The facts about a message that explain a label, and none of its content. Worked out where the
 *  text is already open (the AI worker) and stored with the label. */
export interface Traits {
  channel: Channel;
  /** group: a WhatsApp group. bulk: mail with an unsubscribe header. company: a no-reply or role address. */
  sender: "person" | "company" | "bulk" | "group";
  bulk: boolean;
  attach: boolean;
  len: "short" | "medium" | "long";
  hour: "night" | "morning" | "afternoon" | "evening";
  known: boolean;
  /** model: decided by the model. rule: your rules or corrections decided. sender: the sender's settled bulk verdict.
   *  copied: the same email triaged before. superseded: an older message in a conversation with a newer one.
   *  capped: past the sender's daily cap of model reads (apps/ai/ai/triage_signals.py), left neutral. */
  source: "model" | "rule" | "sender" | "copied" | "superseded" | "capped";
}

/** The labels a person can change by hand today. Category and Needs Reply have no control in the app, so there is
 *  nothing to record; add them here when one is built. */
export type LabelField = "priority" | "junk";

/** The edit made to a draft before it was sent, as facts about the change, not its words. */
export interface DraftEdit {
  edited: boolean;
  /** Words that changed, 0 to 100. */
  changed_pct: number;
  /** Length change in percent, -100 to 500. */
  len_pct: number;
  greeting_changed: boolean;
  signoff_changed: boolean;
  q_added: boolean;
  q_removed: boolean;
  emoji_added: boolean;
  paras_delta: number;
  tone_shift: "same" | "formal" | "casual";
}

export interface Events {
  // Reach and screens
  app_open: { returning: boolean };
  screen_view: Record<string, never>;
  screen_time: { secs: number };
  load_timing: { what: string; ms: number };
  error: { code: string; where: string };
  rage_click: { target: string };
  empty_state: { what: string };
  // Dialogs and features
  dialog_open: { dialog: string };
  dialog_close: { dialog: string; outcome: "submit" | "cancel"; secs: number; fields: string[] };
  feature_used: { feature: string; detail?: string };
  setting_changed: { setting: string };
  search: { len: number; results: number; picked_rank?: number };
  thread_opened: { via: string; channel: Channel; had_summary: boolean; unread: boolean };
  /** The Summary page drawn once a visit: how many rows each section held, so "do summaries save reading" can be answered. */
  summary_shown: { reply: number; priority: number; updates: number; older: number; events: number; tasks: number };
  original_opened: { channel: Channel };
  attachment_used: { action: "open" | "download"; kind: string };
  // Sorting and labels
  triaged: Traits & { priority: string; category: string; junk: boolean; needs_reply: boolean; prompt: string };
  label_corrected: Partial<Traits> & { field: LabelField; from: string; to: string; prompt?: string };
  thread_action: Partial<Traits> & { action: string; opened_first: boolean; mins_since: number };
  reply_sent: { channel: Channel; was_needs_reply: boolean; priority: string; category: string; hours_to_reply: number };
  // Drafts and choices
  /** revises: an edit or adjustment of the text in the reply box. via: how the instruction was given. */
  draft_requested: { tone: string; source: "manual" | "auto" | "choice" | "compose"; channel: Channel; has_instruction?: boolean; revises?: boolean; via?: "typed" | "voice" };
  draft_shown: { tone: string; channel: Channel; ms: number; auto: boolean };
  draft_failed: { code: string; channel: Channel };
  /** A thumbs up or down on a draft; reason is one of a closed list of chips, or none. Never text. */
  draft_rated: { value: "up" | "down"; reason: string };
  draft_sent: Partial<DraftEdit> & { channel: Channel; tone: string; secs_to_send: number; regenerated: number; auto: boolean };
  draft_discarded: { channel: Channel; tone: string; secs: number; auto: boolean };
  choice_shown: { count: number; kinds: string[] };
  choice_tapped: { kind: string };
  // Tasks: a tick or untick in Calendar, and whether the provider took it
  task_ticked: { action: "complete" | "reopen"; provider: string; overdue: boolean; timed: boolean; via: "calendar" | "details" | "summary" };
  task_update: { provider: string; action: string; outcome: "done" | "failed"; code?: string };
  // Brief, voice
  brief_play: { speed: number };
  brief_stop: { pos_s: number; pct: number; done: boolean };
  audio_played: { after_transcript: boolean };
  // Meetings: where a transcript was opened, and how long a search of one was and how many turns it found
  meeting_transcript_opened: { platform: string; where: "conversation" | "contact" | "calendar"; status: string; segments: number };
  meeting_transcript_searched: { len: number; results: number };
  // Accounts and reliability
  account_connect: { provider: string; step: string; outcome: "start" | "done" | "failed"; code?: string };
  first_sync_done: { provider: string; secs: number };
  // Onboarding: the setup dialog's steps
  onboarding_step: { step: string; outcome: "start" | "done" | "skipped" };
  sync_error: { provider: string; code: string };
  /** A send is tried once and never retried (a retry could send the same message twice), so there is no attempts count. */
  send_result: { provider: string; outcome: "sent" | "failed"; code?: string };
  wa_reconnect: { reason: string };
  // The AI worker
  ai_call: {
    feature: string;
    model: string;
    prompt: string;
    ms: number;
    ok: boolean;
    code?: string;
    in_tok: number;
    out_tok: number;
    cached_pct: number;
    cost_micro: number;
    attempts: number;
  };
}

export type EventName = keyof Events;
export interface Event<K extends EventName = EventName> {
  name: K;
  props: Events[K];
  /** A screen other than the one the app is on, such as the one just left. */
  screen?: string;
}

// A code word: lowercase, starting with a letter. A dot is allowed only between two digits ("gemini-2.5-flash",
// "v0.0.12"): a local part ("jane.doe") or a domain ("acme.co") has dots between letters and is refused. The database
// applies the same rule (analytics_word_ok). A lone lowercase word such as a first name has the shape of a code word, so
// free-form sources go through the allow-lists in allowed.ts before they get here.
const WORD = /^[a-z](?:[a-z0-9_:-]|[0-9]\.(?=[0-9]))*$/;
const KEY = /^[a-z][a-z0-9_]{0,29}$/;
const MAX_NUMBER = 1_000_000_000;
const MAX_WORD = 40;

const plainWord = (w: string) => w.length <= MAX_WORD && WORD.test(w);

/** A text value that is only a plain code word. Anything else (a space, a capital, an @, a number
 *  first) is not one, and is dropped rather than changed, so text can never be tidied into a word. */
export function isWord(v: unknown): v is string {
  return typeof v === "string" && plainWord(v);
}

/** The props of an event with everything that is not allowed removed. The database does the same. */
export function cleanProps(props: Record<string, unknown> | undefined): Record<string, number | boolean | string | string[]> {
  const out: Record<string, number | boolean | string | string[]> = {};
  let n = 0;
  for (const [k, v] of Object.entries(props ?? {})) {
    if (n >= 16) break;
    if (!KEY.test(k)) continue;
    if (typeof v === "number") {
      if (!Number.isFinite(v) || Math.abs(v) > MAX_NUMBER) continue;
      out[k] = Math.round(v * 100) / 100;
    } else if (typeof v === "boolean") out[k] = v;
    else if (isWord(v)) out[k] = v;
    else if (Array.isArray(v)) out[k] = v.filter(isWord).slice(0, 12);
    else continue;
    n++;
  }
  return out;
}

/** A name from the app (a dialog's id, a field's name) as a code word, or undefined when it is not one. */
export function wordOf(s: string | null | undefined): string | undefined {
  const w = (s ?? "").trim().toLowerCase().replace(/[\s-]+/g, "_");
  // Not for words on the screen (a button's text can hold a name). Names the code gave things only, and not IDs.
  return plainWord(w) && !/\d{4,}|[0-9a-f]{8,}/.test(w) ? w : undefined;
}

export function sizeOf(width: number): Size {
  return width < 768 ? "phone" : width < 1100 ? "tablet" : "desktop";
}

export function hourBucket(hour: number): Traits["hour"] {
  return hour < 6 ? "night" : hour < 12 ? "morning" : hour < 18 ? "afternoon" : "evening";
}

export function lengthBucket(chars: number): Traits["len"] {
  return chars < 300 ? "short" : chars < 1500 ? "medium" : "long";
}

export function minutesBucket(mins: number): number {
  const steps = [1, 5, 15, 60, 240, 1440, 10080];
  return steps.find((s) => mins <= s) ?? 43200;
}
