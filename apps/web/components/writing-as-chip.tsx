"use client";

// The "Writing As" choice: which of your addresses an email goes from, shown where you write (the reply box and New
// Email) as a stock select. The choices are the account's send addresses; Settings sets the default.

import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectSeparator, SelectTrigger, SelectValue } from "@/components/ui/select";

export interface WritingAsGroup {
  /** The account's name, shown above its addresses when there is more than one group. */
  label?: string;
  items: { value: string; label: string }[];
}

/** The address in use, with the others in its list. Not shown with nothing to choose from. */
export function WritingAsChip({ value, groups, onChange, disabled, id, className }: { value: string; groups: WritingAsGroup[]; onChange: (value: string) => void; disabled?: boolean; id?: string; className?: string }) {
  const current = groups.flatMap((g) => g.items).find((i) => i.value === value);
  if (!current) return null;
  return (
    <Select value={value} onValueChange={onChange} disabled={disabled}>
      <SelectTrigger id={id} aria-label="Writing As" className={className ?? "max-w-48 min-w-0 data-[size=default]:h-8 sm:max-w-72"}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent align="end" className="max-w-80">
        {groups.map((g, i) => (
          <SelectGroup key={g.label ?? i}>
            {i > 0 && <SelectSeparator />}
            {g.label && groups.length > 1 && <SelectLabel>{g.label}</SelectLabel>}
            {g.items.map((it) => <SelectItem key={it.value} value={it.value}>{it.label}</SelectItem>)}
          </SelectGroup>
        ))}
      </SelectContent>
    </Select>
  );
}
