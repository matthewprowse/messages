"use client";

// Small controls of the Contacts list: the Filter in the title row (sort, relationship, and Going Quiet's days on that
// view), what a row shows (the one fact under a name, the service a contact is mostly reached on) and the "/" shortcut
// that focuses search.

import { useEffect } from "react";
import { ListFilter } from "lucide-react";
import { firstReach, type Sort, type View } from "@/lib/contact-list-helpers";
import type { ContactSummary } from "@/lib/contacts";
import { formatPhone } from "@/lib/format";
import { DEFAULT_QUIET_DAYS, QUIET_CHOICES } from "@/lib/going-quiet";
import { ALL_RELATIONSHIPS, relationshipOptions } from "@/lib/relationships";
import type { Provider, Thread } from "@/lib/types";
import { Tip } from "@/components/tip";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuLabel, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";

const SORTS: { value: Sort; label: string }[] = [{ value: "recent", label: "Recent" }, { value: "name", label: "Name" }];

/**
 * The title row's Filter, modelled on the Conversations one: an icon until something other than the default is on, then
 * its name (or "2 Filters"). Going Quiet is not re-sorted, so there its days take the sort's place. Companies have no
 * relationship, so they get the sort alone.
 */
export function ContactsFilter({ view, sort, rel, quiet, contacts, onSort, onRel, onQuiet }: {
  view: View;
  sort: Sort;
  rel: string;
  quiet: number;
  /** Contacts with a relationship, for the relationships in use. */
  contacts: { relationship?: string | null }[];
  onSort: (sort: Sort) => void;
  onRel: (rel: string) => void;
  onQuiet: (days: number) => void;
}) {
  const known = relationshipOptions(contacts);
  // A value from the address bar that is none of them is kept, so it can be seen and cleared.
  const rels = [ALL_RELATIONSHIPS, ...known, ...(rel !== ALL_RELATIONSHIPS && !known.some((r) => r.toLowerCase() === rel.toLowerCase()) ? [rel] : [])];
  // Offered once anyone has a relationship, or while one is chosen.
  const showRel = view !== "companies" && (contacts.length > 0 || rel !== ALL_RELATIONSHIPS);
  const on = [
    view === "quiet" ? (quiet !== DEFAULT_QUIET_DAYS ? `${quiet} Days` : null) : sort !== "recent" ? "By Name" : null,
    showRel && rel !== ALL_RELATIONSHIPS ? rel : null,
  ].filter((x): x is string => !!x);
  const name = on.length > 1 ? `${on.length} Filters` : on[0];
  return (
    <DropdownMenu modal={false}>
      <Tip label="Filter">
        <DropdownMenuTrigger asChild>
          <Button variant={name ? "secondary" : "ghost"} size={name ? "default" : "icon"} aria-label={name ? `Filter, ${name}` : "Filter"}>
            <ListFilter />
            {name}
          </Button>
        </DropdownMenuTrigger>
      </Tip>
      <DropdownMenuContent align="end" className="max-h-80 w-48 overflow-y-auto">
        {view === "quiet" ? (
          <>
            <DropdownMenuLabel>No Contact In</DropdownMenuLabel>
            <DropdownMenuRadioGroup value={String(quiet)} onValueChange={(v) => onQuiet(Number(v))}>
              {QUIET_CHOICES.map((d) => <DropdownMenuRadioItem key={d} value={String(d)}>{d} Days</DropdownMenuRadioItem>)}
            </DropdownMenuRadioGroup>
          </>
        ) : (
          <>
            <DropdownMenuLabel>Sort</DropdownMenuLabel>
            <DropdownMenuRadioGroup value={sort} onValueChange={(v) => onSort(v as Sort)}>
              {SORTS.map((s) => <DropdownMenuRadioItem key={s.value} value={s.value}>{s.label}</DropdownMenuRadioItem>)}
            </DropdownMenuRadioGroup>
          </>
        )}
        {showRel && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuLabel>Relationship</DropdownMenuLabel>
            <DropdownMenuRadioGroup value={rel} onValueChange={onRel}>
              {rels.map((r) => <DropdownMenuRadioItem key={r} value={r}>{r === ALL_RELATIONSHIPS ? "All Relationships" : r}</DropdownMenuRadioItem>)}
            </DropdownMenuRadioGroup>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** The one fact under a name: where they work, else what they do, else how to reach them. */
export function factOf(c: Pick<ContactSummary, "company" | "organizationName" | "role" | "phones" | "handles" | "emails">) {
  return c.company || c.organizationName || c.role || (c.phones[0] ? formatPhone(c.phones[0]) : c.handles[0] ? `@${c.handles[0]}` : firstReach(c));
}

/** Each person's main channel: the service of their newest one-to-one conversation, for the badge on their avatar. */
export function mainProviders(threads: Pick<Thread, "isGroup" | "participantIds" | "provider" | "lastMessageAt">[]) {
  const newest = new Map<string, { at: string; provider: Provider }>();
  for (const t of threads) {
    const id = t.isGroup ? undefined : t.participantIds[0];
    if (!id) continue;
    const seen = newest.get(id);
    if (!seen || t.lastMessageAt > seen.at) newest.set(id, { at: t.lastMessageAt, provider: t.provider });
  }
  return new Map([...newest].map(([id, v]) => [id, v.provider]));
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
