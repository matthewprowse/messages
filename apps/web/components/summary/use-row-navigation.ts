"use client";

// J and K keyboard navigation between the Summary page's rows.

import { useEffect, useRef } from "react";
import { nextRowIndex } from "@/lib/summary-list";

/**
 * J and K move keyboard focus down and up the rows, starting from the focused or open row, and Enter
 * then opens it. E and the other shortcuts act on the focused row.
 */
export function useRowNavigation<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.metaKey || e.ctrlKey || e.altKey || (e.key !== "j" && e.key !== "k")) return;
      const target = e.target as HTMLElement | null;
      if (target?.closest("input, textarea, select, [contenteditable=true], [role=menu], [role=dialog], [role=listbox], [role=combobox]")) return;
      const rows = [...(ref.current?.querySelectorAll<HTMLElement>("[data-row-link]") ?? [])];
      if (rows.length === 0) return;
      const focused = rows.findIndex((r) => r === document.activeElement);
      const open = rows.findIndex((r) => r.getAttribute("aria-current") === "page");
      const next = nextRowIndex(rows.length, focused, open, e.key === "j" ? 1 : -1) ?? 0;
      e.preventDefault();
      rows[next].focus({ preventScroll: true });
      // The row's scroll margin keeps it clear of the floating header.
      rows[next].scrollIntoView({ block: "nearest" });
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  return ref;
}
