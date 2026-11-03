"use client";

// The Notes list's keys: "/" focuses the search, N starts a note, and J and K move focus down and up the rows. None of
// them fire while the keys are going into a field, a menu or a dialog.

import { useEffect, useRef } from "react";

const TYPING = "input, textarea, select, [contenteditable=true], [role=menu], [role=dialog], [role=alertdialog]";

/** "/" focuses the search and N starts a note, unless the keys are going into a field. */
export function useListShortcuts(search: React.RefObject<HTMLInputElement | null>, onNew: () => void) {
  const latest = useRef(onNew);
  latest.current = onNew;
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.metaKey || e.ctrlKey || e.altKey || e.defaultPrevented) return;
      if ((e.target as HTMLElement | null)?.closest(TYPING)) return;
      if (e.key === "/") {
        e.preventDefault();
        search.current?.focus();
      } else if (e.key === "n" || e.key === "N") {
        e.preventDefault();
        latest.current();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [search]);
}

/** J and K move keyboard focus down and up the rows, starting from the focused or open one. */
export function useRowNavigation<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.metaKey || e.ctrlKey || e.altKey || (e.key !== "j" && e.key !== "k")) return;
      if ((e.target as HTMLElement | null)?.closest(TYPING)) return;
      const rows = [...(ref.current?.querySelectorAll<HTMLElement>("[data-row-link]") ?? [])];
      if (rows.length === 0) return;
      const from = rows.findIndex((r) => r === document.activeElement);
      const at = from !== -1 ? from : rows.findIndex((r) => r.getAttribute("aria-current") === "page");
      const next = at === -1 ? 0 : Math.min(rows.length - 1, Math.max(0, at + (e.key === "j" ? 1 : -1)));
      e.preventDefault();
      rows[next].focus({ preventScroll: true });
      rows[next].scrollIntoView({ block: "nearest" });
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  return ref;
}
