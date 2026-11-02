"use client";

// Small controls of the Contacts list header: the sort select and the "/" shortcut that focuses search.

import { useEffect } from "react";
import type { Sort } from "@/lib/contact-list-helpers";
import { PaneSelect } from "@/components/pane";

/** Sort choices, in the same small select as the Inbox's filter. */
export function SortMenu({ sort, onChange }: { sort: Sort; onChange: (sort: Sort) => void }) {
  return <PaneSelect label="Sort" value={sort} onChange={(v) => onChange(v as Sort)} options={[{ value: "recent", label: "Recent" }, { value: "name", label: "Name" }]} />;
}

/** "/" jumps to the search box, unless you are already typing somewhere. */
export function useSlashFocus(input: React.RefObject<HTMLInputElement | null>) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "/" || e.metaKey || e.ctrlKey || e.altKey || e.defaultPrevented) return;
      const t = e.target;
      if (t instanceof HTMLElement && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
      if (document.querySelector("[role=dialog], [role=alertdialog], [role=menu]")) return;
      const el = input.current;
      if (!el || el.offsetParent === null) return;
      e.preventDefault();
      el.focus();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [input]);
}
