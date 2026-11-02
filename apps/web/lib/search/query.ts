// Reads what was typed in a search box: plain words, "quoted phrases" and the operators from:, to:, has:attachment,
// is:unread, before: and after:. Pure. Anything that is not a known operator (a time such as 10:30, a link) stays a word.

import { fold } from "./fold";
import type { ParsedQuery } from "./types";

const DAY_MS = 86_400_000;

/** One piece of the input: a word or phrase, or an operator and its value. */
type Piece = { op?: string; value: string; quoted: boolean };

function pieces(input: string): Piece[] {
  const out: Piece[] = [];
  let i = 0;
  while (i < input.length) {
    if (/\s/.test(input[i])) { i++; continue; }
    // A name before a colon, then a value that may be quoted: from:"Jane Doe".
    const named = /^([a-zA-Z]+):/.exec(input.slice(i));
    let op: string | undefined;
    if (named) { op = named[1].toLowerCase(); i += named[0].length; }
    let value = "";
    let quoted = false;
    if (input[i] === '"') {
      quoted = true;
      const end = input.indexOf('"', i + 1);
      value = input.slice(i + 1, end < 0 ? input.length : end);
      i = end < 0 ? input.length : end + 1;
    } else {
      const start = i;
      while (i < input.length && !/\s/.test(input[i])) i++;
      value = input.slice(start, i);
    }
    out.push({ op, value, quoted });
  }
  return out;
}

/** The start of a local day in ms for 2026-11-02, 2026/11/02, 2026-11 (the 1st), 2026, today or yesterday; null when it is none of those. */
export function parseDay(value: string, now: Date = new Date()): number | null {
  const v = value.trim().toLowerCase();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  if (v === "today") return today;
  if (v === "yesterday") return today - DAY_MS;
  const m = /^(\d{4})(?:[-/](\d{1,2})(?:[-/](\d{1,2}))?)?$/.exec(v);
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2] ?? 1), Number(m[3] ?? 1)];
  const date = new Date(y, mo - 1, d);
  // new Date rolls 31 February into March: a day that moved is not a real day.
  if (date.getFullYear() !== y || date.getMonth() !== mo - 1 || date.getDate() !== d) return null;
  return date.getTime();
}

/** Parses a search box's text. `now` is only for today and yesterday. */
export function parseQuery(input: string, now: Date = new Date()): ParsedQuery {
  const q: ParsedQuery = { terms: [], phrases: [], from: [], to: [], hasAttachment: false, unread: false, hasOperators: false, empty: true };
  for (const { op, value, quoted } of pieces(input)) {
    const v = fold(value);
    switch (op) {
      case "from": q.hasOperators = true; if (v) q.from.push(v); continue;
      case "to": q.hasOperators = true; if (v) q.to.push(v); continue;
      case "has": {
        if (/^(attachments?|files?)$/.test(v)) { q.hasOperators = true; q.hasAttachment = true; continue; }
        break;
      }
      case "is": {
        if (v === "unread") { q.hasOperators = true; q.unread = true; continue; }
        break;
      }
      case "before": case "after": {
        q.hasOperators = true;
        const day = parseDay(value, now);
        if (day !== null) q[op] = day;
        continue;
      }
    }
    // Not an operator: the whole piece, colon included, is text.
    const text = op ? fold(`${op}:${value}`) : v;
    if (!text) continue;
    if (quoted && !op) q.phrases.push(text);
    else q.terms.push(...text.split(" "));
  }
  q.empty = !q.hasOperators && q.terms.length === 0 && q.phrases.length === 0;
  return q;
}

/** The words and phrases of a query as one string, for the plain list filter used while the index is not ready. */
export function plainText(q: ParsedQuery): string {
  return [...q.terms, ...q.phrases].join(" ");
}
