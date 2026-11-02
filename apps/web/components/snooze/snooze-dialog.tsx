"use client";

// The Snooze dialog: ready-made times, or a day from a calendar. Opened by H, by Pick a Date in the menus and by the Snooze
// button on a row. Remind Me If No Reply uses it too (mode "remind"), with 1, 3 and 7 days instead.

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DIALOG_BUTTONS } from "@/components/merge-dialog";
import { pickedDay, reminderChoices, returnText, snoozeChoices } from "@/lib/snooze";

/** What is being snoozed, and whether the dialog opens on the ready-made times or on the calendar. */
export interface SnoozeRequest {
  ids: string[];
  mode: "snooze" | "remind";
  step: "choices" | "date";
}

export function SnoozeDialog({ request, onClose, onPick }: { request: SnoozeRequest | null; onClose: () => void; onPick: (request: SnoozeRequest, at: Date) => void }) {
  const [step, setStep] = useState<"choices" | "date">("choices");
  const [day, setDay] = useState<Date | undefined>();
  useEffect(() => {
    if (request) { setStep(request.step); setDay(undefined); }
  }, [request]);
  if (!request) return <Dialog open={false} onOpenChange={() => undefined} />;
  const remind = request.mode === "remind";
  const now = new Date();
  const choices = remind ? reminderChoices(now) : snoozeChoices(now);
  const many = request.ids.length > 1;
  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent showCloseButton={false} className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>{remind ? "Remind Me If No Reply" : "Snooze"}</DialogTitle>
          <DialogDescription>
            {remind
              ? "It comes back to your inbox with a Follow Up tag if nobody has replied by then."
              : `${many ? "They leave" : "It leaves"} your inbox and ${many ? "return" : "returns"} at the time you choose, or as soon as someone writes.`}
          </DialogDescription>
        </DialogHeader>
        {step === "choices" ? (
          <div className="flex flex-col">
            {choices.map((c) => (
              <Button key={c.key} type="button" variant="ghost" className="justify-between font-normal" onClick={() => onPick(request, c.at)}>
                {c.label}
                <span className="text-xs text-muted-foreground">{returnText(c.at.toISOString(), now)}</span>
              </Button>
            ))}
            <Button type="button" variant="ghost" className="justify-start font-normal" onClick={() => setStep("date")}>Pick a Date</Button>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-2">
            <Calendar mode="single" selected={day} onSelect={setDay} defaultMonth={day} weekStartsOn={1} disabled={{ before: now }} />
            <p className="text-xs text-muted-foreground">{day ? `Returns ${returnText(pickedDay(day, now).toISOString(), now)}.` : "Choose a day. It returns at 08:00."}</p>
          </div>
        )}
        <div className={DIALOG_BUTTONS}>
          <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
          {step === "date" && <Button type="button" disabled={!day} onClick={() => day && onPick(request, pickedDay(day, now))}>{remind ? "Set Reminder" : "Snooze"}</Button>}
        </div>
      </DialogContent>
    </Dialog>
  );
}
