"use client";

// The search box and the type filter above a timeline. Only types that have something are offered, each with its count.

import { Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { TIMELINE_TYPES, TYPE_LABEL, type TimelineType } from "@/lib/timeline/types";

export function TimelineFilters({ term, onTerm, types, onTypes, counts }: {
  term: string; onTerm: (term: string) => void;
  types: TimelineType[]; onTypes: (types: TimelineType[]) => void;
  counts: Map<TimelineType, number>;
}) {
  const offered = TIMELINE_TYPES.filter((t) => (counts.get(t) ?? 0) > 0 || types.includes(t));
  return (
    <div className="flex flex-col gap-2">
      <div className="relative">
        <Search aria-hidden className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input value={term} onChange={(e) => onTerm(e.target.value)} placeholder="Search This Timeline" aria-label="Search This Timeline" className="pl-8" />
      </div>
      {offered.length > 1 && (
        <ToggleGroup type="multiple" variant="outline" size="sm" spacing={1} value={types} onValueChange={(v) => onTypes(v as TimelineType[])} className="flex-wrap justify-start" aria-label="Show Only">
          {offered.map((t) => <ToggleGroupItem key={t} value={t} aria-label={TYPE_LABEL[t]}>{TYPE_LABEL[t]} {counts.get(t) ?? 0}</ToggleGroupItem>)}
        </ToggleGroup>
      )}
    </div>
  );
}
