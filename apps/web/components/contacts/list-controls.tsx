"use client";

// Small controls of the Contacts list: the sort select, the relationship filter, the Going Quiet days and the "/" shortcut that focuses search.

import { useEffect } from "react";
import type { Sort } from "@/lib/contact-list-helpers";
import { PaneSelect } from "@/components/pane";
import { QUIET_CHOICES } from "@/lib/going-quiet";
import { ALL_RELATIONSHIPS, relationshipOptions } from "@/lib/relationships";

/** Sort choices, in the same small select as the Inbox's filter. */
export function SortMenu({ sort, onChange }: { sort: Sort; onChange: (sort: Sort) => void }) {
  return <PaneSelect label="Sort" value={sort} onChange={(v) => onChange(v as Sort)} options={[{ value: "recent", label: "Recent" }, { value: "name", label: "Name" }]} />;
}

/** Going Quiet's "no contact in" choice, in the place of the sort. */
export function QuietDaysMenu({ days, onChange }: { days: number; onChange: (days: number) => void }) {
  return <PaneSelect label="No Contact In" value={String(days)} onChange={(v) => onChange(Number(v))} options={QUIET_CHOICES.map((d) => ({ value: String(d), label: `${d} Days` }))} />;
}

/** Everyone, or one relationship: the six to pick from and any custom one in use. A value from the address bar that is none of them is kept. */
export function RelationshipFilter({ contacts, value, onChange }: { contacts: { relationship?: string | null }[]; value: string; onChange: (value: string) => void }) {
  const known = relationshipOptions(contacts);
  const options = [ALL_RELATIONSHIPS, ...known, ...(value !== ALL_RELATIONSHIPS && !known.some((r) => r.toLowerCase() === value.toLowerCase()) ? [value] : [])];
  return <PaneSelect label="Relationship" className="w-44" value={value} onChange={onChange} options={options.map((o) => ({ value: o, label: o === ALL_RELATIONSHIPS ? "All Relationships" : o }))} />;
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
