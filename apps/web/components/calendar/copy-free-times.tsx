"use client";

// Copy Free Times: the gaps in working hours over the next few working days, or over dates picked on a calendar, as text
// to paste into a reply ("Thursday 14:00 to 15:00, Friday 09:30 to 10:30"). The sums are in lib/free-times.ts; this loads
// the events for the days and shows the result.

import { useEffect, useMemo, useState } from "react";
import type { DateRange } from "react-day-picker";
import { toast } from "sonner";
import { dayKey, fromDateKey, addDays } from "@/lib/dates";
import { loadEvents, type CalendarEvent } from "@/lib/calendar";
import { browserStorage } from "@/lib/event-calendars";
import { DEFAULT_HOURS, formatFreeTimes, freeTimes, minutesOf, nextWorkingDays, readHours, timeOfMinutes, workingDaysBetween, writeHours, type WorkingHours } from "@/lib/free-times";
import { TimeSelect } from "@/components/new-event/event-fields";
import { DIALOG_BUTTONS } from "@/components/merge-dialog";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

const RANGE = "range";
const LENGTHS = [{ value: "30", label: "30 Minutes" }, { value: "60", label: "1 Hour" }, { value: "120", label: "2 Hours" }];
const COUNTS = ["3", "5", "10"];

/** The Copy Free Times dialog. `queued` are events saved here that may not be in the loaded days yet, so they block time too. */
export function CopyFreeTimes({ open, onOpenChange, queued, now }: { open: boolean; onOpenChange: (open: boolean) => void; queued: CalendarEvent[]; now: Date }) {
  const timeZone = useMemo(() => {
    try { return Intl.DateTimeFormat().resolvedOptions().timeZone; } catch { return "Africa/Johannesburg"; }
  }, []);
  const [mode, setMode] = useState("5");
  const [range, setRange] = useState<DateRange | undefined>(undefined);
  const [hours, setHours] = useState<WorkingHours>(DEFAULT_HOURS);
  const [minutes, setMinutes] = useState("30");
  const [events, setEvents] = useState<CalendarEvent[] | null | undefined>(undefined);

  useEffect(() => {
    if (open) setHours(readHours(browserStorage()));
  }, [open]);

  const days = useMemo(() => {
    if (mode !== RANGE) return nextWorkingDays(now, Number(mode), hours, timeZone);
    return range?.from ? workingDaysBetween(dayKey(range.from), dayKey(range.to ?? range.from)) : [];
  }, [mode, range, hours, now, timeZone]);
  const first = days[0];
  const last = days[days.length - 1];

  // The events over those days; the day either side is read too, as loadEvents does, for events that run across midnight.
  useEffect(() => {
    if (!open || !first || !last) { setEvents(first ? undefined : []); return; }
    let cancelled = false;
    setEvents(undefined);
    loadEvents(fromDateKey(first)!, addDays(fromDateKey(last)!, 1), { details: false })
      .then((list) => { if (!cancelled) setEvents(list); })
      .catch((err) => {
        console.error(err instanceof Error ? err.message : "Load events failed");
        if (!cancelled) setEvents(null);
      });
    return () => { cancelled = true; };
  }, [open, first, last]);

  const text = useMemo(() => {
    if (!events) return "";
    const busy = [...events, ...queued.filter((q) => !events.some((e) => e.id === q.id))];
    return formatFreeTimes(freeTimes(days, busy, { hours, timeZone, now, minMinutes: Number(minutes) }), timeZone, now);
  }, [events, queued, days, hours, timeZone, now, minutes]);

  const setBound = (which: keyof WorkingHours) => (value: string) => {
    const at = minutesOf(value);
    if (at === null) return;
    const next = which === "start" ? { start: at, end: Math.max(hours.end, at + 30) } : { start: Math.min(hours.start, at - 30), end: at };
    setHours(next);
    writeHours(browserStorage(), next);
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      toast("Free times copied.");
    } catch {
      toast.error("Could not copy. Select the text and copy it yourself.");
    }
  };

  const status = events === undefined ? "Checking your calendar" : events === null ? "Your events did not load. Check your connection and try again." : !days.length ? "Pick the days to look at." : !text ? "No free time in these days." : null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent showCloseButton={false} className="max-h-[calc(100svh-2rem)] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Copy Free Times</DialogTitle>
          <DialogDescription>Gaps in your working hours, in your time zone ({timeZone}), ready to paste into a reply.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <div className="grid gap-2">
            <Label htmlFor="free-days">Days</Label>
            <Select value={mode} onValueChange={setMode}>
              <SelectTrigger id="free-days" className="w-full"><SelectValue /></SelectTrigger>
              <SelectContent>
                {COUNTS.map((n) => <SelectItem key={n} value={n}>Next {n} Working Days</SelectItem>)}
                <SelectItem value={RANGE}>Choose Dates</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {mode === RANGE && (
            <div className="flex justify-center rounded-lg border">
              <Calendar mode="range" selected={range} onSelect={setRange} weekStartsOn={1} disabled={{ before: now }} />
            </div>
          )}
          <div className="grid grid-cols-3 gap-4">
            <div className="grid gap-2">
              <Label htmlFor="free-from">From</Label>
              <TimeSelect id="free-from" value={timeOfMinutes(hours.start)} onChange={setBound("start")} invalid={false} disabled={false} />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="free-to">To</Label>
              <TimeSelect id="free-to" value={timeOfMinutes(hours.end)} onChange={setBound("end")} invalid={false} disabled={false} />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="free-length">At Least</Label>
              <Select value={minutes} onValueChange={setMinutes}>
                <SelectTrigger id="free-length" className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent>{LENGTHS.map((l) => <SelectItem key={l.value} value={l.value}>{l.label}</SelectItem>)}</SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid gap-2">
            <Label htmlFor="free-text">Free Times</Label>
            {status ? <p id="free-text" className="text-sm text-muted-foreground">{status}</p> : <Textarea id="free-text" readOnly rows={4} value={text} />}
          </div>
        </div>
        <div className={DIALOG_BUTTONS}>
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>Close</Button>
          <Button type="button" variant="secondary" disabled={!text} onClick={() => void copy()}>Copy</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
