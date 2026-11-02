// Unchecked checklist items in a note's markdown, for Extract Tasks. Deterministic: no AI, just the "- [ ] text"
// lines the editor writes. Pure, so it runs under node:test.

import { decodeEntities } from "./note-text";

/** Longest title a task keeps (lib/tasks.ts MAX_TASK_TITLE); longer items are cut rather than refused. */
const MAX_ITEM = 500;

/** The text of each unchecked item, in order, with markup tidied and repeats and empty items dropped. */
export function uncheckedItems(markdown: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  let fenced = false;
  for (const raw of markdown.split("\n")) {
    if (/^\s*(```|~~~)/.test(raw)) { fenced = !fenced; continue; }
    if (fenced) continue;
    const m = /^[ \t]*(?:[-*+]|\d+[.)])\s+\[ \]\s+(.*)$/.exec(raw);
    if (!m) continue;
    const text = tidy(m[1]);
    const key = text.toLowerCase();
    if (!text || seen.has(key)) continue;
    seen.add(key);
    out.push(text.length > MAX_ITEM ? `${text.slice(0, MAX_ITEM - 1).trimEnd()}…` : text);
  }
  return out;
}

/** One item as plain text: links keep their words, emphasis marks go. */
function tidy(text: string): string {
  return decodeEntities(text
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/(\*\*|__|~~|`)/g, "")
    .replace(/(^|[^\w])[*_]([^*_]+)[*_](?=[^\w]|$)/g, "$1$2")
    .replace(/\\(.)/g, "$1")
    .replace(/\s+/g, " ")
    .trim());
}

/** The notes text a task made from a note carries, so it says where it came from (and for whom). */
export function taskNotesFrom(noteTitle: string, contactName?: string): string {
  const title = noteTitle.trim() || "Untitled Note";
  return contactName ? `From the note "${title}" for ${contactName}.` : `From the note "${title}".`;
}
