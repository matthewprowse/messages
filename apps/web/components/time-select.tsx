// The one time picker in the app: a stock shadcn Select of times every `step` minutes. New Event, New Task and Send
// Later all use it, so a time is never picked with the browser's own time box (which iOS shows as a wheel).

import { useMemo } from "react";
import { timeChoices } from "@/lib/dates";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

// Select items cannot have an empty value, so "no time" travels as this and comes back out as "".
const NO_TIME = "none";

/**
 * A time as "HH:MM". A value off the step (an event made elsewhere at 09:10) is still listed, so it is never lost.
 * With `allowNone`, the first item is No Time and picking it sends "".
 */
export function TimeSelect({ id, value, onChange, step = 15, allowNone = false, invalid = false, disabled = false }: { id?: string; value: string; onChange: (v: string) => void; step?: number; allowNone?: boolean; invalid?: boolean; disabled?: boolean }) {
  const times = useMemo(() => timeChoices(value, step), [value, step]);
  return (
    <Select value={allowNone && !value ? NO_TIME : value} onValueChange={(v) => onChange(v === NO_TIME ? "" : v)} disabled={disabled}>
      <SelectTrigger id={id} className="w-full tabular-nums" aria-invalid={invalid}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent className="max-h-72">
        {allowNone && <SelectItem value={NO_TIME}>No Time</SelectItem>}
        {times.map((t) => <SelectItem key={t} value={t} className="tabular-nums">{t}</SelectItem>)}
      </SelectContent>
    </Select>
  );
}
