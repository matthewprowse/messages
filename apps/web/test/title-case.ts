// Pure helpers for the Title Case check on button labels (title-case.test.ts): pulling the label text out of a
// component's source, and deciding whether a label is in Title Case as the UI rules in AGENTS.md want it.

/** Short words that stay lower case inside a title ("Pick a Date and Time"), never first or last. */
const MINOR = new Set("a an and as at but by for from if in into nor of off on onto or per the to via vs with".split(" "));
/** Names that are spelt with a small first letter. */
const BRANDED = new Set(["iCloud", "iPhone", "iPad", "macOS"]);

/** Whether every word of a label is capitalised, except short joining words inside it. */
export function isTitleCase(label: string): boolean {
  const words = label.trim().split(/\s+/).filter(Boolean);
  return words.every((raw, i) => {
    const word = raw.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "");
    if (!word || !/^\p{L}/u.test(word) || BRANDED.has(word)) return true;
    if (/^\p{Lu}/u.test(word)) return true;
    return i > 0 && i < words.length - 1 && MINOR.has(word);
  });
}

/** Elements whose text is a control's label, and dialog titles, which follow the same rule as headings. */
const CONTROLS = ["Button", "DropdownMenuItem", "DropdownMenuCheckboxItem", "DropdownMenuRadioItem", "DropdownMenuSubTrigger", "ContextMenuItem", "TabsTrigger", "ToggleGroupItem", "AlertDialogAction", "AlertDialogCancel", "DialogTitle", "AlertDialogTitle"];

/** The index just past a JSX tag that starts at `from` (at its "<"), skipping ">" inside braces and strings. */
function tagEnd(src: string, from: number): number {
  let depth = 0;
  let quote = "";
  for (let i = from + 1; i < src.length; i++) {
    const c = src[i];
    if (quote) { if (c === quote && src[i - 1] !== "\\") quote = ""; continue; }
    if (c === '"' || c === "'" || c === "`") quote = c;
    else if (c === "{") depth++;
    else if (c === "}") depth--;
    else if (c === ">" && depth === 0) return i + 1;
  }
  return src.length;
}

/**
 * The static label text of one control's children: JSX text and the string literals in its expressions ("Saving" and
 * "Save" in {saving ? "Saving" : "Save"}). Nested tags are skipped whole, so class names and icons never count.
 */
function labelsIn(children: string): string[] {
  const out: string[] = [];
  let text = "";
  const flush = () => { if (text.trim()) out.push(text.trim()); text = ""; };
  for (let i = 0; i < children.length;) {
    const c = children[i];
    if (c === "<") { flush(); i = tagEnd(children, i); continue; }
    if (c === "{") {
      flush();
      let depth = 1;
      let j = i + 1;
      for (; j < children.length && depth > 0; j++) {
        const d = children[j];
        if (d === "{") depth++;
        else if (d === "}") depth--;
        else if (d === '"' || d === "`") {
          const close = children.indexOf(d, j + 1);
          if (close < 0) break;
          const literal = children.slice(j + 1, close).replace(/\$\{[^}]*\}/g, "0");
          // Only text a person reads: it has a capital or a space, unlike keys and class names ("ghost", "size-4").
          if (/^[\p{L}\p{N} ,.'?!&]+$/u.test(literal) && /[\p{Lu} ]/u.test(literal) && literal.trim()) out.push(literal.trim());
          j = close;
        } else if (d === "<") j = tagEnd(children, j) - 1;
      }
      i = j;
      continue;
    }
    text += c;
    i++;
  }
  flush();
  return out;
}

/** Every static label in a component's source: control and dialog title children, and any aria-label on a control. */
export function buttonLabels(src: string): string[] {
  const labels: string[] = [];
  for (const m of src.matchAll(new RegExp(`<(${CONTROLS.join("|")})\\b`, "g"))) {
    const open = tagEnd(src, m.index);
    const opening = src.slice(m.index, open);
    const aria = /aria-label="([^"]+)"/.exec(opening);
    if (aria) labels.push(aria[1]);
    if (opening.endsWith("/>")) continue;
    const close = src.indexOf(`</${m[1]}>`, open);
    if (close > open) labels.push(...labelsIn(src.slice(open, close)));
  }
  return labels;
}
