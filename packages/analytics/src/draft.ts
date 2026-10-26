import type { DraftEdit } from "./index";

const GREETING = /^(hi|hello|hey|dear|good\s+(morning|afternoon|evening)|morning|afternoon|evening)\b/i;
const SIGNOFF = /^(kind\s+regards|best\s+regards|warm\s+regards|regards|best|thanks|thank\s+you|cheers|sincerely|yours|many\s+thanks|talk\s+soon|speak\s+soon)\b/i;
const EMOJI = /\p{Extended_Pictographic}/gu;
const FORMAL = /\b(dear|regards|kindly|sincerely|please\s+find|i\s+would|do\s+not|cannot|yours)\b/gi;
const CASUAL = /\b(hey|hi|cheers|thanks|thx|cool|great|yeah|yep|gonna|i'll|i'm|don't|can't|we'll|no\s+worries)\b|!|\p{Extended_Pictographic}/giu;

const words = (s: string) => s.toLowerCase().split(/\s+/).filter(Boolean);
const paragraphs = (s: string) => s.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean).length;
const lines = (s: string) => s.split("\n").map((l) => l.trim()).filter(Boolean);
const count = (s: string, re: RegExp) => (s.match(re) ?? []).length;
const norm = (s: string) => s.replace(/\s+/g, " ").trim();

function greetingOf(s: string): string {
  const first = lines(s)[0] ?? "";
  return first.length <= 50 && GREETING.test(first) ? norm(first.toLowerCase()) : "";
}

function signoffOf(s: string): string {
  const tail = lines(s).slice(-3);
  const at = tail.findIndex((l) => l.length <= 40 && SIGNOFF.test(l));
  return at < 0 ? "" : norm(tail.slice(at).join(" ").toLowerCase());
}

/** Share of words that differ, 0 to 100, from a word-level edit distance (long texts are compared on their first 300 words). */
export function changedPct(a: string, b: string): number {
  const x = words(a).slice(0, 300);
  const y = words(b).slice(0, 300);
  if (x.length === 0 && y.length === 0) return 0;
  let prev = Array.from({ length: y.length + 1 }, (_, j) => j);
  for (let i = 1; i <= x.length; i++) {
    const cur = [i];
    for (let j = 1; j <= y.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (x[i - 1] === y[j - 1] ? 0 : 1));
    prev = cur;
  }
  return Math.min(100, Math.round((prev[y.length] / Math.max(x.length, y.length)) * 100));
}

function tone(s: string): number {
  return count(s, FORMAL) - count(s, CASUAL);
}

/** What the person changed in a draft before sending it: facts about the change, never its words. */
export function draftEdit(draft: string, sent: string): DraftEdit {
  const a = norm(draft);
  const b = norm(sent);
  const edited = a !== b;
  const shift = tone(sent) - tone(draft);
  return {
    edited,
    changed_pct: edited ? changedPct(draft, sent) : 0,
    len_pct: a.length === 0 ? 0 : Math.max(-100, Math.min(500, Math.round(((b.length - a.length) / a.length) * 100))),
    greeting_changed: greetingOf(draft) !== greetingOf(sent),
    signoff_changed: signoffOf(draft) !== signoffOf(sent),
    q_added: count(sent, /\?/g) > count(draft, /\?/g),
    q_removed: count(sent, /\?/g) < count(draft, /\?/g),
    emoji_added: count(sent, EMOJI) > count(draft, EMOJI),
    paras_delta: Math.max(-5, Math.min(5, paragraphs(sent) - paragraphs(draft))),
    tone_shift: shift <= -2 ? "casual" : shift >= 2 ? "formal" : "same",
  };
}
