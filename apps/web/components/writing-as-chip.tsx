"use client";

// The "Writing As" chip: which of your addresses an email goes from, shown where you write (the reply box and New
// Email) and changed from its menu. The choices are the account's send addresses; Settings sets the default.

import { ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuLabel, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";

export interface WritingAsGroup {
  /** The account's name, shown above its addresses when there is more than one group. */
  label?: string;
  items: { value: string; label: string }[];
}

/** A chip showing the address in use, with a menu of the others. Not shown with nothing to choose from. */
export function WritingAsChip({ value, groups, onChange, disabled, id, className }: { value: string; groups: WritingAsGroup[]; onChange: (value: string) => void; disabled?: boolean; id?: string; className?: string }) {
  const current = groups.flatMap((g) => g.items).find((i) => i.value === value);
  if (!current) return null;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button id={id} type="button" variant="secondary" size="sm" disabled={disabled} aria-label={`Writing As ${current.label}`} className={className ?? "h-8 max-w-48 min-w-0 gap-1.5 rounded-full sm:max-w-72"}>
          <span className="shrink-0 text-muted-foreground">Writing As</span>
          <span className="min-w-0 truncate">{current.label}</span>
          <ChevronDown className="shrink-0" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="max-w-80">
        <DropdownMenuRadioGroup value={value} onValueChange={onChange}>
          {groups.map((g, i) => (
            <div key={g.label ?? i}>
              {i > 0 && <DropdownMenuSeparator />}
              {g.label && groups.length > 1 && <DropdownMenuLabel>{g.label}</DropdownMenuLabel>}
              {g.items.map((it) => <DropdownMenuRadioItem key={it.value} value={it.value}>{it.label}</DropdownMenuRadioItem>)}
            </div>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
