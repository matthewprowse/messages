"use client";

// The search and the type filter above a timeline: a 40px search, and a Filter that is an icon until a type is picked,
// then its name. Only types that have something are offered, each with its count.

import { ListFilter, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Tip } from "@/components/tip";
import { TIMELINE_TYPES, TYPE_LABEL, type TimelineType } from "@/lib/timeline/types";

export function TimelineFilters({ term, onTerm, types, onTypes, counts }: {
  term: string; onTerm: (term: string) => void;
  types: TimelineType[]; onTypes: (types: TimelineType[]) => void;
  counts: Map<TimelineType, number>;
}) {
  const offered = TIMELINE_TYPES.filter((t) => (counts.get(t) ?? 0) > 0 || types.includes(t));
  const name = types.length > 1 ? `${types.length} Types` : types[0] ? TYPE_LABEL[types[0]] : undefined;
  const toggle = (t: TimelineType, on: boolean) => onTypes(on ? [...types, t] : types.filter((x) => x !== t));
  return (
    <div className="flex items-center gap-1">
      <div className="relative min-w-0 flex-1">
        <Search aria-hidden className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          type="search"
          value={term}
          onChange={(e) => onTerm(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Escape" && term) { e.stopPropagation(); onTerm(""); } }}
          placeholder="Search Timeline"
          aria-label="Search Timeline"
          autoComplete="off"
          className="h-10 bg-background pl-8"
        />
      </div>
      {offered.length > 1 && (
        <DropdownMenu modal={false}>
          <Tip label="Filter">
            <DropdownMenuTrigger asChild>
              <Button variant={name ? "secondary" : "ghost"} size={name ? "default" : "icon"} aria-label={name ? `Filter, ${name}` : "Filter"}>
                <ListFilter />
                {name}
              </Button>
            </DropdownMenuTrigger>
          </Tip>
          <DropdownMenuContent align="end" className="w-48">
            {offered.map((t) => (
              <DropdownMenuCheckboxItem key={t} checked={types.includes(t)} onSelect={(e) => e.preventDefault()} onCheckedChange={(on) => toggle(t, on === true)}>
                {TYPE_LABEL[t]}
                <span className="ml-auto text-xs tabular-nums text-muted-foreground">{counts.get(t) ?? 0}</span>
              </DropdownMenuCheckboxItem>
            ))}
            {types.length > 0 && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={() => onTypes([])}>Show All</DropdownMenuItem>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </div>
  );
}
