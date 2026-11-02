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
  /** model: decided by the model. rule: your rules or corrections decided. copied: the same email triaged before. */
  source: "model" | "rule" | "copied";
}

export type LabelField = "priority" | "category" | "junk" | "needs_reply";

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
  // Onboarding: the setup dialog's steps and the tour of the app
  onboarding_step: { step: string; outcome: "start" | "done" | "skipped" };
  tour_step: { step: string; outcome: "next" | "skipped" | "done" };
  sync_error: { provider: string; code: string };
  send_result: { provider: string; outcome: "sent" | "failed"; attempts: number; code?: string };
  wa_reconnect: { reason: string };
  sync_lag: { provider: string; secs: number };
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

const WORD = /^[a-z][a-z0-9_.:-]{0,39}$/;
const KEY = /^[a-z][a-z0-9_]{0,29}$/;
const MAX_NUMBER = 1_000_000_000;

/** Code words the app sends that hold a dot. A dot is how a local part ("jane.doe") or a domain ("acme.co") looks, so
 *  any other word with one is dropped. No caller sends a dotted word today; add one here when one starts to. */
export const DOTTED_WORDS: ReadonlySet<string> = new Set<string>();

const plainWord = (w: string) => WORD.test(w) && (!w.includes(".") || DOTTED_WORDS.has(w));

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
