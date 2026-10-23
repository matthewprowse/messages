// Bold, italics and the like for chat bubbles, kept as ranges over plain text so nothing a sender wrote
// is ever put on the page as HTML. Pure helpers: no React and no DOM, so they run under node:test.
import { linkParts, type Emphasis, type Mark } from "./email-text";

export type { Emphasis, Mark };

/** Characters start to end of a text carry mark. */
export interface MarkRange {
  start: number;
  end: number;
  mark: Mark;
}

export type RichPart = ({ text: string } | { href: string; label: string }) & { marks?: Mark[] };

const ALNUM = /[\p{L}\p{N}]/u;
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Finds the styled runs of an email in the text its bubble shows. Each mark is searched for after the
 * last place it was found, so a repeated word is marked where the HTML had it; a run that is not after
 * that place (the text part sometimes orders things differently) is looked for from the start. Spaces in
 * a run match any whitespace, as the bubble text may wrap or join lines. A mark covering most of a long
 * email is the layout's default font, not emphasis, and is dropped.
 */
export function findEmphasis(text: string, runs: Emphasis[]): MarkRange[] {
  const out: MarkRange[] = [];
  const after: Partial<Record<Mark, number>> = {};
  for (const run of runs) {
    const re = new RegExp(run.text.split(" ").map(escape).join("\\s+"), "gu");
    const find = (from: number) => {
      re.lastIndex = from;
      for (let m = re.exec(text); m; m = re.exec(text)) {
        const start = m.index;
        const end = start + m[0].length;
        // Whole words only, so "art" in bold does not mark the middle of "start".
        if ((start === 0 || !ALNUM.test(text[start - 1]) || !ALNUM.test(run.text[0])) && (end === text.length || !ALNUM.test(text[end]) || !ALNUM.test(run.text.at(-1) ?? ""))) return { start, end };
        re.lastIndex = start + 1;
      }
      return null;
    };
    const hit = find(after[run.mark] ?? 0) ?? (after[run.mark] ? find(0) : null);
    if (!hit) continue;
    out.push({ ...hit, mark: run.mark });
    after[run.mark] = hit.end;
  }
  const letters = (s: string) => (s.match(/[\p{L}\p{N}]/gu) ?? []).length;
  const total = letters(text);
  if (total < 120) return out;
  const covered = new Map<Mark, number>();
  for (const mark of new Set(out.map((r) => r.mark))) {
    const flags = new Uint8Array(text.length);
    for (const r of out) if (r.mark === mark) flags.fill(1, r.start, r.end);
    let n = 0;
    for (let i = 0; i < text.length; i++) if (flags[i] && ALNUM.test(text[i])) n++;
    covered.set(mark, n);
  }
  return out.filter((r) => (covered.get(r.mark) ?? 0) <= total * 0.6);
}

/** The ranges inside text.slice(start, end), moved to start at 0. */
export function sliceRanges(ranges: MarkRange[], start: number, end: number): MarkRange[] {
  const out: MarkRange[] = [];
  for (const r of ranges) {
    const s = Math.max(r.start, start);
    const e = Math.min(r.end, end);
    if (e > s) out.push({ start: s - start, end: e - start, mark: r.mark });
  }
  return out;
}

const MARK_ORDER: Mark[] = ["bold", "italic", "underline", "strike", "code"];

function marksAt(ranges: MarkRange[], start: number, end: number): Mark[] | undefined {
  const marks = MARK_ORDER.filter((m) => ranges.some((r) => r.mark === m && r.start <= start && r.end >= end));
  return marks.length ? marks : undefined;
}

/**
 * Text split into plain runs and links, each carrying the marks over it. A link takes a mark only
 * when the mark covers all of it. With shorten, link labels become host plus a short path.
 */
export function richParts(text: string, ranges: MarkRange[], shorten = true): RichPart[] {
  const out: RichPart[] = [];
  let at = 0;
  for (const part of linkParts(text, shorten)) {
    if ("href" in part) {
      const marks = marksAt(ranges, at, at + part.href.length);
      out.push(marks ? { ...part, marks } : part);
      at += part.href.length;
      continue;
    }
    const end = at + part.text.length;
    // Every place a mark starts or stops inside this run splits it.
    const cuts = new Set([at, end]);
    for (const r of ranges) {
      if (r.start > at && r.start < end) cuts.add(r.start);
      if (r.end > at && r.end < end) cuts.add(r.end);
    }
    const points = [...cuts].sort((a, b) => a - b);
    for (let i = 0; i < points.length - 1; i++) {
      const piece = text.slice(points[i], points[i + 1]);
      const marks = marksAt(ranges, points[i], points[i + 1]);
      const last = out.at(-1);
      // Neighbouring plain runs with the same marks are one run.
      if (last && "text" in last && String(last.marks) === String(marks)) last.text += piece;
      else out.push(marks ? { text: piece, marks } : { text: piece });
    }
    at = end;
  }
  return out;
}

const WA_MARKERS: { token: string; mark: Mark }[] = [
  { token: "```", mark: "code" },
  { token: "`", mark: "code" },
  { token: "*", mark: "bold" },
  { token: "_", mark: "italic" },
  { token: "~", mark: "strike" },
];
const URL_AT = /https?:\/\/[^\s<>"']+/y;

/** Where token closes after from: not after a space, not before a letter or digit, on the same line except for ```. */
function closing(s: string, token: string, from: number): number {
  for (let k = s.indexOf(token, from); k >= 0; k = s.indexOf(token, k + 1)) {
    if (token !== "```" && s.slice(from, k).includes("\n")) return -1;
    if (k === from || /\s/.test(s[k - 1])) continue;
    const next = s[k + token.length];
    if (next !== undefined && (ALNUM.test(next) || next === token[0])) continue;
    return k;
  }
  return -1;
}

/**
 * WhatsApp's own formatting: *bold*, _italic_, ~strikethrough~, `code` and ```monospace```, nested as
 * WhatsApp allows (*_both_*). The markers go and their text is marked. A marker counts only at a word's
 * edge with text right inside it, as in WhatsApp, so 2*3*4, snake_case_names and "* item" lists stay
 * as typed. Links are copied through untouched, so underscores in an address never turn into italics.
 */
export function whatsappMarkup(input: string): { text: string; ranges: MarkRange[] } {
  let text = "";
  const ranges: MarkRange[] = [];
  const walk = (s: string, open: Set<Mark>) => {
    let i = 0;
    while (i < s.length) {
      URL_AT.lastIndex = i;
      const url = (i === 0 || !ALNUM.test(s[i - 1])) && URL_AT.exec(s);
      if (url) {
        // Markers right after a link close what was opened before it ("*https://x.com*").
        const href = url[0].replace(/[*_~`]+$/, "");
        text += href;
        i += href.length;
        continue;
      }
      let used = false;
      if (i === 0 || !ALNUM.test(s[i - 1])) {
        for (const { token, mark } of WA_MARKERS) {
          if (!s.startsWith(token, i) || open.has(mark)) continue;
          const inner = i + token.length;
          if (inner >= s.length || /\s/.test(s[inner]) || s.startsWith(token[0], inner)) continue;
          const end = closing(s, token, inner);
          if (end < 0) continue;
          const start = text.length;
          // Nothing inside code is formatting.
          if (mark === "code") text += s.slice(inner, end);
          else walk(s.slice(inner, end), new Set([...open, mark]));
          ranges.push({ start, end: text.length, mark });
          i = end + token.length;
          used = true;
          break;
        }
      }
      if (!used) text += s[i++];
    }
  };
  walk(input, new Set());
  return { text, ranges: ranges.sort((a, b) => a.start - b.start) };
}
