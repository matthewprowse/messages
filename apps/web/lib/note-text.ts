// Pure helpers for notes, kept apart from Supabase and React so they run under node:test.
//
// A note is stored as markdown. A file attached to it is written on a line of its own as
// "![name](attachment:<id>)" for an image or "[name](attachment:<id>)" for anything else, where id is the
// note_attachments row. Links to files are made fresh each time a note opens, so none are stored.

/** A file reference on its own line, at the start of src. */
export const FILE_LINE = /^(!?)\[([^\]\n]*)\]\(attachment:([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\)[ \t]*(?:\n|$)/;
const FILE_REF = /\]\(attachment:([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\)/g;

/** Each file a note's markdown still refers to. */
export function referencedFiles(markdown: string): Set<string> {
  return new Set(Array.from(markdown.matchAll(FILE_REF), (m) => m[1]));
}

/** The files no longer in the note, to delete once it is closed. */
export function unusedFiles<T extends { id: string }>(files: T[], markdown: string): T[] {
  const used = referencedFiles(markdown);
  return files.filter((f) => !used.has(f.id));
}

/** The markdown line for a file. Square brackets and line breaks in its name would end the reference early. */
export function fileLine(id: string, name: string, image: boolean): string {
  const label = name.replace(/[[\]\n\r]/g, " ").replace(/\s+/g, " ").trim();
  return `${image ? "!" : ""}[${label}](attachment:${id})`;
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

/** The editor writes &, < and > in text as HTML entities, so they cannot be read as markup. */
export function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, code: string) => {
    if (code[0] !== "#") return ENTITIES[code.toLowerCase()] ?? whole;
    const n = code[1] === "x" || code[1] === "X" ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
    return Number.isFinite(n) && n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : whole;
  });
}

/**
 * The first line of text in a note, without its markdown, for the list. File references, rules and code
 * fences are passed over, and a backslash before a character is dropped.
 */
export function notePreview(markdown: string, max = 140): string {
  for (const raw of markdown.split("\n")) {
    const text = plainLine(raw);
    if (text) return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
  }
  return "";
}

/**
 * The start of a note as plain text, for the list and for search before the body is downloaded: the first
 * lines of text joined with spaces, about max characters. Stored with the note, so it is kept short.
 */
export function noteExcerpt(markdown: string, max = 200): string {
  const parts: string[] = [];
  let length = 0;
  for (const raw of markdown.split("\n")) {
    const text = plainLine(raw);
    if (!text) continue;
    parts.push(text);
    length += text.length + 1;
    if (length > max) break;
  }
  const joined = parts.join(" ");
  return joined.length > max ? `${joined.slice(0, max - 1).trimEnd()}…` : joined;
}

/** One line of markdown as plain text, or "" when it holds none (blank, a rule, a fence, a file, a table divider). */
function plainLine(raw: string): string {
  const line = raw.trim();
  if (!line || /^(```|~~~|-{3,}|\*{3,}|_{3,})/.test(line) || FILE_LINE.test(line) || /^\|?[\s:|-]+\|[\s:|-]*$/.test(line)) return "";
  return decodeEntities(line
    .replace(/^#{1,6}\s+/, "")
    .replace(/^>\s?/, "")
    .replace(/^([-*+]|\d+[.)])\s+(\[[ xX]\]\s+)?/, "")
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/(\*\*|__|~~|`)/g, "")
    .replace(/(^|[^\w])[*_]([^*_]+)[*_](?=[^\w]|$)/g, "$1$2")
    .replace(/\|/g, " ")
    .replace(/\\(.)/g, "$1")
    .replace(/\s+/g, " ")
    .trim());
}

/** The words of a search, lowercased. */
export function searchWords(term: string): string[] {
  return term.toLowerCase().split(/\s+/).filter(Boolean);
}

/**
 * The first line of text that holds one of the search words, as plain text trimmed to about max characters
 * around the match; null when only the title matched.
 */
export function matchingLine(markdown: string, term: string, max = 140): string | null {
  const words = searchWords(term);
  if (words.length === 0) return null;
  for (const raw of markdown.split("\n")) {
    const text = plainLine(raw);
    if (!text) continue;
    const lower = text.toLowerCase();
    const at = Math.min(...words.map((w) => lower.indexOf(w)).filter((i) => i !== -1), Infinity);
    if (at === Infinity) continue;
    if (text.length <= max) return text;
    const from = Math.max(0, Math.min(at - 24, text.length - max));
    const slice = text.slice(from, from + max).trim();
    return `${from > 0 ? "…" : ""}${slice}${from + max < text.length ? "…" : ""}`;
  }
  return null;
}

/** A note with no title, text or files, which is dropped when it is closed. */
export function isBlankNote(note: { title: string; body: string }): boolean {
  return !note.title.trim() && !note.body.replace(/&nbsp;| /g, "").trim();
}

/** Newest first, with pinned notes above the rest. */
export function sortNotes<T extends { pinned: boolean; updatedAt: string }>(notes: T[]): T[] {
  return [...notes].sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.updatedAt.localeCompare(a.updatedAt));
}

/**
 * Search over the title and text, every word matching somewhere. While a note's body has not been
 * downloaded (`unloaded`), its excerpt stands in for it.
 */
export function matchesNote(note: { title: string; body: string; excerpt?: string | null; unloaded?: boolean }, term: string): boolean {
  const words = searchWords(term);
  if (words.length === 0) return true;
  const text = note.unloaded ? note.excerpt ?? "" : decodeEntities(note.body);
  const hay = `${note.title}\n${text}`.toLowerCase();
  return words.every((w) => hay.includes(w));
}
