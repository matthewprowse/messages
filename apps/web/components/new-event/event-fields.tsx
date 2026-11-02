// Small field components for the New Event dialog (components/new-event-dialog.tsx): the time list, a switch row, the
// date picker, the Repeat list and the "reconnect your calendar" notice. Each is controlled; the dialog owns the state.

import { useMemo } from "react";
import Link from "next/link";
import { ChevronDownIcon } from "lucide-react";
import type { Account } from "@/lib/types";
import { dateKey } from "@/lib/new-items";
import { fromDateKey, NO_REPEAT, timesWith, UNKNOWN_REPEAT } from "@/lib/event-form";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export function TimeSelect({ id, value, onChange, invalid, disabled }: { id: string; value: string; onChange: (v: string) => void; invalid: boolean; disabled: boolean }) {
  const times = useMemo(() => timesWith(value), [value]);
  return (
    <Select value={value} onValueChange={onChange} disabled={disabled}>
      <SelectTrigger id={id} className="w-full tabular-nums" aria-invalid={invalid}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent className="max-h-72">
        {times.map((t) => <SelectItem key={t} value={t} className="tabular-nums">{t}</SelectItem>)}
      </SelectContent>
    </Select>
  );
}

export function Reconnect({ provider, change = false }: { provider?: Account["provider"]; change?: boolean }) {
  const verb = change ? "changing" : "creating";
  const title = !provider ? `Connect a calendar to ${change ? "change" : "create"} events` : provider === "icloud_calendar" ? `Reconnect iCloud Calendar to allow ${verb} events` : `Reconnect Google to allow ${verb} events`;
  return (
    <Alert>
      <AlertTitle>{title}</AlertTitle>
      <AlertDescription>
        <p>
          Open <Link href="/settings/accounts" className="text-foreground underline underline-offset-2">Connected Accounts</Link>, {provider ? "reconnect it" : "connect Google or iCloud Calendar"}, then try again.
        </p>
      </AlertDescription>
    </Alert>
  );
}

export function SwitchRow({ id, label, checked, onChange, disabled }: { id: string; label: string; checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <Label htmlFor={id}>{label}</Label>
      <Switch id={id} checked={checked} onCheckedChange={onChange} disabled={disabled} />
    </div>
  );
}

/** The Date field: a button that opens a calendar. `date` is "YYYY-MM-DD". */
export function DateField({ date, onChange, open, onOpenChange, error, disabled }: { date: string; onChange: (key: string) => void; open: boolean; onOpenChange: (open: boolean) => void; error: string | null; disabled: boolean }) {
  return (
    <div className="grid gap-2">
      <Label htmlFor="event-date">Date</Label>
      <Popover open={open} onOpenChange={onOpenChange}>
        <PopoverTrigger asChild>
          <Button id="event-date" type="button" variant="outline" className="w-full justify-between font-normal" aria-invalid={!!error} disabled={disabled}>
            {fromDateKey(date)?.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric" }) ?? "Pick a Date"}
            <ChevronDownIcon className="text-muted-foreground" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-auto overflow-hidden p-0" align="start">
          <Calendar
            mode="single"
            selected={fromDateKey(date)}
            defaultMonth={fromDateKey(date)}
            weekStartsOn={1}
            captionLayout="dropdown"
            onSelect={(d) => {
              if (d) onChange(dateKey(d));
              onOpenChange(false);
            }}
          />
        </PopoverContent>
      </Popover>
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}

/** The Repeat field. `value` is the Select value from repeatSelectValue; picking none or unknown sets "". */
export function RepeatField({ value, options, onChange, repeating, repeatChanged, othersChanged, disabled }: { value: string; options: { value: string; label: string }[]; onChange: (rule: string) => void; repeating: boolean; repeatChanged: boolean; othersChanged: boolean; disabled: boolean }) {
  return (
    <div className="grid gap-2">
      <Label htmlFor="event-repeat">Repeat</Label>
      <Select value={value} onValueChange={(v) => onChange(v === NO_REPEAT || v === UNKNOWN_REPEAT ? "" : v)} disabled={disabled}>
        <SelectTrigger id="event-repeat" className="w-full"><SelectValue /></SelectTrigger>
        <SelectContent>
          {options.map((o) => (
            // A series cannot be turned back into one event from here: delete it, or change it in your calendar.
            <SelectItem key={o.value} value={o.value} disabled={(repeating && o.value === NO_REPEAT) || o.value === UNKNOWN_REPEAT}>{o.label}</SelectItem>
          ))}
        </SelectContent>
      </Select>
      {repeating && repeatChanged && <p className="text-xs text-muted-foreground">A new repeat is saved to every event in the series{othersChanged ? ", whichever you save" : ""}.</p>}
    </div>
  );
}
