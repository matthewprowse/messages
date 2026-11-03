"use client";

// The Attachments header's Filter, built like Conversations' (components/thread-list/list-controls.tsx): a ghost icon at
// rest, a secondary button with the filter's name, or "2 Filters", once any is on. Source, Date, Document and Sort are radio
// groups; Show Hidden adds the hidden files under the grid. The page owns the values (they live in the address).

import { ListFilter } from "lucide-react";
import { DOC_FILTERS, type DocType } from "@/lib/search/document-card";
import { SORTS, type Sort } from "@/lib/attachment-actions/selection";
import { DATES } from "@/lib/attachment-filters";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";

/** What the menu sets. `doc` is "all" for Any Document. */
export type FileFilters = { source: string; date: string; doc: "all" | DocType; sort: Sort; hidden: boolean };

/** The names of the filters that are on, in menu order: the button shows the one, or counts them. */
export function activeFilterNames(f: FileFilters, sources: { key: string; label: string }[]): string[] {
  return [
    f.source !== "all" ? sources.find((s) => s.key === f.source)?.label ?? f.source : "",
    f.date !== "any" ? DATES.find((d) => d.key === f.date)?.label ?? "" : "",
    f.doc !== "all" ? DOC_FILTERS.find((d) => d.key === f.doc)?.label ?? "" : "",
    f.sort !== "newest" ? SORTS.find((s) => s.key === f.sort)?.label ?? "" : "",
    f.hidden ? "Show Hidden" : "",
  ].filter(Boolean);
}

export function FilterMenu({ value, sources, onChange, onClear }: { value: FileFilters; sources: { key: string; label: string }[]; onChange: (patch: Partial<FileFilters>) => void; onClear: () => void }) {
  const on = activeFilterNames(value, sources);
  const name = on.length > 1 ? `${on.length} Filters` : on[0];
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant={name ? "secondary" : "ghost"} size={name ? "default" : "icon"} aria-label={name ? `Filter, ${name}` : "Filter"}>
          <ListFilter />
          {name}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-52">
        <DropdownMenuLabel>Source</DropdownMenuLabel>
        <DropdownMenuRadioGroup value={value.source} onValueChange={(source) => onChange({ source })}>
          <DropdownMenuRadioItem value="all">All Sources</DropdownMenuRadioItem>
          {sources.map((s) => <DropdownMenuRadioItem key={s.key} value={s.key}>{s.label}</DropdownMenuRadioItem>)}
        </DropdownMenuRadioGroup>
        <DropdownMenuSeparator />
        <DropdownMenuLabel>Date</DropdownMenuLabel>
        <DropdownMenuRadioGroup value={value.date} onValueChange={(date) => onChange({ date })}>
          {DATES.map((d) => <DropdownMenuRadioItem key={d.key} value={d.key}>{d.label}</DropdownMenuRadioItem>)}
        </DropdownMenuRadioGroup>
        <DropdownMenuSeparator />
        <DropdownMenuLabel>Document</DropdownMenuLabel>
        <DropdownMenuRadioGroup value={value.doc} onValueChange={(doc) => onChange({ doc: doc as FileFilters["doc"] })}>
          {DOC_FILTERS.map((d) => <DropdownMenuRadioItem key={d.key} value={d.key}>{d.label}</DropdownMenuRadioItem>)}
        </DropdownMenuRadioGroup>
        <DropdownMenuSeparator />
        <DropdownMenuLabel>Sort</DropdownMenuLabel>
        <DropdownMenuRadioGroup value={value.sort} onValueChange={(sort) => onChange({ sort: sort as Sort })}>
          {SORTS.map((s) => <DropdownMenuRadioItem key={s.key} value={s.key}>{s.label}</DropdownMenuRadioItem>)}
        </DropdownMenuRadioGroup>
        <DropdownMenuSeparator />
        <DropdownMenuCheckboxItem checked={value.hidden} onCheckedChange={(hidden) => onChange({ hidden: !!hidden })}>Show Hidden</DropdownMenuCheckboxItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem disabled={on.length === 0} onSelect={onClear}>Clear Filters</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
