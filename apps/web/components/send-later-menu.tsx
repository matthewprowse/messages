"use client";

// The Send Later menu that sits beside Send in the reply box, New Email and New WhatsApp: three quick times and a
// date and time picker. It only chooses a time; the caller queues the message with it (send_after on the outbox row).

import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { combineDateTime, describeWhen, laterChoices, scheduleError, type LaterChoice } from "@/lib/send-schedule";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { TimeSelect } from "@/components/time-select";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";

export function SendLaterMenu({ disabled, onPick, variant = "secondary", className }: { disabled?: boolean; onPick: (at: Date) => void; variant?: "secondary" | "default" | "outline"; className?: string }) {
  // The choices are worked out when the menu opens, so "Later Today" is never stale.
  const [now, setNow] = useState(() => new Date());
  const [picking, setPicking] = useState(false);
  const choices = laterChoices(now);
  return (
    <>
      <DropdownMenu onOpenChange={(open) => { if (open) setNow(new Date()); }}>
        <DropdownMenuTrigger asChild>
          <Button type="button" variant={variant} size="icon" disabled={disabled} aria-label="Send Later" className={className}><ChevronDown /></Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-64">
          {choices.map((c: LaterChoice) => (
            <DropdownMenuItem key={c.key} onSelect={() => onPick(c.at)}>
              {c.label}
              <span className="ml-auto text-xs text-muted-foreground tabular-nums">{describeWhen(c.at, now)}</span>
            </DropdownMenuItem>
          ))}
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => setPicking(true)}>Pick a Date and Time</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      {picking && <PickTime onClose={() => setPicking(false)} onPick={(at) => { setPicking(false); onPick(at); }} />}
    </>
  );
}

function startOfToday() { const d = new Date(); d.setHours(0, 0, 0, 0); return d; }

/** The date and time dialog: the stock calendar and the shared time list, and a plain footer. */
function PickTime({ onClose, onPick }: { onClose: () => void; onPick: (at: Date) => void }) {
  const [day, setDay] = useState<Date | undefined>(() => { const d = new Date(); d.setDate(d.getDate() + 1); return d; });
  const [time, setTime] = useState("08:00");
  const [dateOpen, setDateOpen] = useState(false);
  const [checked, setChecked] = useState(false);
  const when = combineDateTime(day, time);
  const error = scheduleError(when, new Date());
  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent track="send_later" className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Send Later</DialogTitle>
          <DialogDescription>Pick when this goes out, in your local time. You can change or cancel it until then.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <div className="grid gap-2">
            <Label htmlFor="later-date">Date</Label>
            <Popover open={dateOpen} onOpenChange={setDateOpen}>
              <PopoverTrigger asChild>
                <Button id="later-date" type="button" variant="outline" className="w-full justify-between font-normal">
                  <span className={cn("truncate", !day && "text-muted-foreground")}>{day ? describeWhen(day, new Date()).replace(/ \d{2}:\d{2}$/, "") : "Pick a Date"}</span>
                  <ChevronDown className="text-muted-foreground" />
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto overflow-hidden p-0" align="start">
                <Calendar
                  mode="single"
                  selected={day}
                  defaultMonth={day}
                  weekStartsOn={1}
                  captionLayout="dropdown"
                  disabled={{ before: startOfToday() }}
                  onSelect={(d) => { if (d) setDay(d); setDateOpen(false); }}
                />
              </PopoverContent>
            </Popover>
          </div>
          <div className="grid gap-2">
            <Label htmlFor="later-time">Time</Label>
            <TimeSelect id="later-time" value={time} onChange={setTime} invalid={checked && !!error} />
          </div>
          {checked && error && <p className="text-xs text-destructive">{error}</p>}
        </div>
        <DialogFooter>
          <Button type="button" onClick={() => { setChecked(true); if (when && !error) onPick(when); }}>Schedule</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
