"use client";

// Choosing how much of a chat to share with the team (whole history, from today, or from a date): the field, and the dialog used by Mark as Work.

import { useEffect, useState } from "react";
import { ChevronDown } from "lucide-react";
import { toast } from "sonner";
import { firstMessageAt, markPersonal, markWork, type ShareFrom } from "@/lib/share";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DIALOG_BUTTONS } from "@/components/merge-dialog";

export type ShareChoice = "whole" | "today" | "date";

const day = (d: Date | string) => new Date(d).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });

/** Share From: the whole history, from today or from a date, with a line saying what each means. Used by Mark as Work and the review after joining. */
export function ShareFromField({ choice, onChoice, date, onDate, idPrefix = "share" }: { choice: ShareChoice; onChoice: (choice: ShareChoice) => void; date: Date | undefined; onDate: (date: Date) => void; idPrefix?: string }) {
  const [dateOpen, setDateOpen] = useState(false);
  return (
    <div className="grid gap-2">
      <Label htmlFor={`${idPrefix}-from`}>Share From</Label>
      <Select value={choice} onValueChange={(v) => onChoice(v as ShareChoice)}>
        <SelectTrigger id={`${idPrefix}-from`} className="w-full"><SelectValue /></SelectTrigger>
        <SelectContent>
          <SelectItem value="whole">Whole History</SelectItem>
          <SelectItem value="today">From Today</SelectItem>
          <SelectItem value="date">From a Date</SelectItem>
        </SelectContent>
      </Select>
      {choice === "date" && (
        <Popover open={dateOpen} onOpenChange={setDateOpen}>
          <PopoverTrigger asChild>
            <Button id={`${idPrefix}-date`} type="button" variant="outline" className="w-full justify-between font-normal">
              {date ? day(date) : "Pick a Date"}
              <ChevronDown className="text-muted-foreground" />
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-auto overflow-hidden p-0" align="start">
            <Calendar
              mode="single"
              selected={date}
              defaultMonth={date}
              weekStartsOn={1}
              captionLayout="dropdown"
              disabled={{ after: new Date() }}
              onSelect={(d) => {
                if (d) onDate(d);
                setDateOpen(false);
              }}
            />
          </PopoverContent>
        </Popover>
      )}
      <p className="text-xs text-muted-foreground">
        {choice === "whole" ? "Everything in this chat is shared."
          : choice === "today" ? "Only messages from now on are shared. Earlier ones stay private to you."
          : date ? `Messages from ${day(date)} on are shared. Earlier ones stay private to you.`
          : "Choose the first day to share. Earlier messages stay private to you."}
      </p>
    </div>
  );
}

/** How far back a choice shares from: the whole history (null), now, or the chosen day. */
export function shareFromOf(choice: ShareChoice, date: Date | undefined): ShareFrom {
  return choice === "whole" ? null : choice === "today" ? new Date() : date ?? null;
}

/**
 * Marking a chat as work: how much of it to share (the whole history, from today or from a date), how far back it
 * goes, and with strict sharing on, that it cannot be undone. Messages before the chosen date stay private to the agent.
 */
export function MarkWorkDialog({ threadId, open, strict, suggested = false, onOpenChange, onDone }: { threadId: string; open: boolean; strict: boolean; /** Konva suggested this chat, so it is recorded as shared by a suggestion. */ suggested?: boolean; onOpenChange: (open: boolean) => void; onDone: () => void }) {
  const [choice, setChoice] = useState<ShareChoice>("whole");
  const [date, setDate] = useState<Date | undefined>();
  const [first, setFirst] = useState<string | null | undefined>(undefined);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setFirst(undefined);
    void firstMessageAt(threadId).then(setFirst, () => setFirst(null));
  }, [open, threadId]);

  const close = (next: boolean) => {
    if (busy) return;
    onOpenChange(next);
    // Reset once it has faded out.
    if (!next) setTimeout(() => { setChoice("whole"); setDate(undefined); }, 200);
  };

  const ready = choice !== "date" || !!date;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy || !ready) return;
    setBusy(true);
    const problem = await markWork(threadId, shareFromOf(choice, date), suggested);
    setBusy(false);
    if (problem) return void toast.error(problem);
    toast("Marked as work");
    onDone();
    close(false);
  };

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent track="mark_work" className="sm:max-w-md">
        <form onSubmit={submit} className="space-y-4">
          <DialogHeader>
            <DialogTitle>Mark as Work</DialogTitle>
            <DialogDescription>
              Your team can read what you share, and so can anyone you or an owner or admin assign this chat to. Everything you do not share stays private to you.
            </DialogDescription>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            {first === undefined ? "Checking how far back this chat goes." : first ? `This chat goes back to ${day(first)}.` : "This chat has no messages stored yet."}
          </p>
          <ShareFromField choice={choice} onChoice={setChoice} date={date} onDate={setDate} />
          {strict && (
            <p className="text-sm">
              Strict sharing is on for your team. Once this chat is shared it stays shared until an owner or admin releases it, so this cannot be undone. People with the Compliance role can read it.
            </p>
          )}
          <div className={DIALOG_BUTTONS}>
            <Button type="submit" disabled={busy || !ready}>{busy ? "Sharing" : "Mark as Work"}</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Moving a work chat back to personal: the team stops reading it at once. The owner sees only a count. */
export function MovePersonalDialog({ threadId, open, onOpenChange, onDone }: { threadId: string; open: boolean; onOpenChange: (open: boolean) => void; onDone: () => void }) {
  const [busy, setBusy] = useState(false);
  return (
    <AlertDialog open={open} onOpenChange={(next) => !busy && onOpenChange(next)}>
      <AlertDialogContent track="move_to_personal">
        <AlertDialogHeader>
          <AlertDialogTitle>Move to Personal?</AlertDialogTitle>
          <AlertDialogDescription>
            Your team can no longer read this chat, and anyone it is assigned to loses access. The messages stay with you. Your team&apos;s owner sees only a count of chats moved back, never which chat.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <div className={DIALOG_BUTTONS}>
          <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            disabled={busy}
            onClick={async (e) => {
              e.preventDefault();
              setBusy(true);
              const problem = await markPersonal(threadId);
              setBusy(false);
              if (problem) return void toast.error(problem);
              toast("Moved to personal");
              onDone();
              onOpenChange(false);
            }}
          >
            {busy ? "Moving" : "Move to Personal"}
          </AlertDialogAction>
        </div>
      </AlertDialogContent>
    </AlertDialog>
  );
}
