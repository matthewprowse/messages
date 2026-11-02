// Snippets: short text you type as ;shortcut in the reply box and it becomes the full text. Pure: composer.tsx calls
// expandSnippet on every change, and the Templates settings use the same shortcut rules.

import { fillVariables, type TemplateVars } from "./template-vars";

export interface Snippet {
  shortcut: string;
  body: string;
}

/** Longest shortcut, in characters, after the semicolon. */
export const MAX_SHORTCUT = 24;

/** A shortcut as stored: no semicolon, lowercase letters, digits, dashes and underscores. "" when nothing usable is left. */
export function normaliseShortcut(raw: string): string {
  return raw.trim().replace(/^;+/, "").toLowerCase().replace(/[^a-z0-9_-]/g, "").slice(0, MAX_SHORTCUT);
}

/**
 * When the character just typed ends a ;shortcut that starts a word, the value with the snippet's text in its place
 * (variables filled) and where the caret goes. Null when there is nothing to expand. It fires on the space or line
 * break after the shortcut, so typing ";th" on the way to ";thanks" never expands early.
 */
export function expandSnippet(value: string, caret: number, snippets: Snippet[], vars: TemplateVars): { text: string; caret: number } | null {
  if (caret < 3 || caret > value.length || !/\s/.test(value[caret - 1])) return null;
  const upto = value.slice(0, caret - 1);
  const start = Math.max(upto.lastIndexOf(" "), upto.lastIndexOf("\n"), upto.lastIndexOf("\t")) + 1;
  const token = upto.slice(start);
  if (!token.startsWith(";")) return null;
  const key = normaliseShortcut(token);
  if (!key || key !== token.slice(1).toLowerCase()) return null;
  const snippet = snippets.find((s) => s.shortcut === key);
  if (!snippet) return null;
  const filled = fillVariables(snippet.body, vars);
  return { text: value.slice(0, start) + filled + value.slice(caret - 1), caret: start + filled.length + 1 };
}
