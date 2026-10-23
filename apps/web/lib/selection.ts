// Pure helpers for picking conversations in the list and for the list's keyboard shortcuts.

/**
 * The selection after clicking a row's checkbox. A plain click toggles that row. A shift-click selects
 * every row between the last row clicked and this one, as in Mail and Gmail.
 */
export function toggleSelection(order: string[], picked: string[], id: string, anchor: string | null, range: boolean): string[] {
  const inList = new Set(order);
  const next = new Set(picked.filter((p) => inList.has(p)));
  const from = anchor ? order.indexOf(anchor) : -1;
  const to = order.indexOf(id);
  if (range && from !== -1 && to !== -1) {
    const [lo, hi] = from < to ? [from, to] : [to, from];
    for (const row of order.slice(lo, hi + 1)) next.add(row);
  } else if (next.has(id)) {
    next.delete(id);
  } else {
    next.add(id);
  }
  return order.filter((row) => next.has(row));
}

export type ShortcutAction = "archive" | "trash" | "junk";

/** E archives, # or the Delete key deletes, ! moves to or out of Junk. Shortcuts with Cmd, Ctrl or Alt are left alone. */
export function shortcutAction(e: { key: string; metaKey: boolean; ctrlKey: boolean; altKey: boolean }): ShortcutAction | null {
  if (e.metaKey || e.ctrlKey || e.altKey) return null;
  if (e.key === "e" || e.key === "E") return "archive";
  if (e.key === "#" || e.key === "Delete") return "trash";
  if (e.key === "!") return "junk";
  return null;
}
