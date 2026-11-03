"use client";

// Extract Tasks: the unchecked checklist items of a note become tasks, each through the same queue as New Task
// (store createTask, then the worker makes it at the task provider). No AI: the items are the "- [ ]" lines. The
// person picks which items, the account and one due date (every task needs a date to show on the Calendar). The
// task's notes say which note and client it came from, because a task cannot be tied to a contact directly.

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ChevronDownIcon } from "lucide-react";
import { toast } from "sonner";
import { markSubmitted, track } from "@/lib/analytics";
import { useApp } from "@/lib/store";
import { dayKey, fromDateKey } from "@/lib/dates";
import { taskNotesFrom, uncheckedItems } from "@/lib/note-checklist";
import { TASK_PROVIDERS, TASK_PROVIDER_NAMES } from "@/lib/tasks";
import { DIALOG_BUTTONS } from "@/components/merge-dialog";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export function ExtractTasksDialog({ open, onOpenChange, title, body, contactName }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  /** The note's markdown as it is now. */
  body: string;
  /** The client the note is linked to, named in each task's notes. */
  contactName?: string;
}) {
  const { accounts, createTask } = useApp();
  const choices = useMemo(() => accounts.filter((a) => (TASK_PROVIDERS as readonly string[]).includes(a.provider) && a.status !== "disconnected"), [accounts]);
  const items = useMemo(() => (open ? uncheckedItems(body) : []), [open, body]);
  const [picked, setPicked] = useState<Set<number>>(new Set());
  const [accountId, setAccountId] = useState("");
  const [date, setDate] = useState("");
  const [dateOpen, setDateOpen] = useState(false);

  // Each time it opens every item is picked, on the first account, due today.
  useEffect(() => {
    if (!open) return;
    setPicked(new Set(uncheckedItems(body).map((_, i) => i)));
    setAccountId(choices[0]?.id ?? "");
    setDate(dayKey(new Date()));
    setDateOpen(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const nameOf = (a: (typeof choices)[number]) => {
    const name = TASK_PROVIDER_NAMES[a.provider] ?? a.provider;
    return choices.filter((c) => c.provider === a.provider).length > 1 && a.detail ? `${name} (${a.detail})` : name;
  };
  const toggle = (i: number, on: boolean) => setPicked((p) => { const n = new Set(p); if (on) n.add(i); else n.delete(i); return n; });

  const submit = () => {
    const chosen = items.filter((_, i) => picked.has(i));
    if (chosen.length === 0 || !accountId || !date) return;
    markSubmitted("extract_tasks");
    const notes = taskNotesFrom(title, contactName);
    for (const t of chosen) createTask({ title: t, notes, accountId, date, time: "", priority: 0 });
    track("feature_used", { feature: "note_tasks_extracted", detail: String(Math.min(chosen.length, 20)) });
    toast(chosen.length === 1 ? "Making 1 task." : `Making ${chosen.length} tasks.`);
    onOpenChange(false);
  };

  const noTaskList = choices.length === 0;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent track="extract_tasks" className="max-h-[calc(100svh-2rem)] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Extract Tasks</DialogTitle>
          <DialogDescription>Unchecked items in this note become tasks in your task list, shown on the Calendar page.</DialogDescription>
        </DialogHeader>
        {noTaskList ? (
          <Alert>
            <AlertTitle>Connect a Task List to Add Tasks</AlertTitle>
            <AlertDescription>
              <p>Open <Link href="/settings/accounts" className="text-foreground underline underline-offset-2">Settings, Connected Accounts</Link>, connect Microsoft To Do, Google Tasks or iCloud Reminders, then try again.</p>
            </AlertDescription>
          </Alert>
        ) : items.length === 0 ? (
          <Alert>
            <AlertTitle>No Unchecked Items</AlertTitle>
            <AlertDescription><p>Add a checklist to the note, then try again.</p></AlertDescription>
          </Alert>
        ) : (
          <div className="grid gap-4">
            <ul className="grid max-h-60 gap-2 overflow-y-auto" aria-label="Items">
              {items.map((text, i) => (
                <li key={i} className="flex items-start gap-2 text-sm">
                  <Checkbox id={`extract-${i}`} checked={picked.has(i)} onCheckedChange={(on) => toggle(i, on === true)} className="mt-0.5" />
                  <Label htmlFor={`extract-${i}`} className="font-normal leading-snug">{text}</Label>
                </li>
              ))}
            </ul>
            {choices.length > 1 && (
              <div className="grid gap-2">
                <Label htmlFor="extract-account">Account</Label>
                <Select value={accountId} onValueChange={setAccountId}>
                  <SelectTrigger id="extract-account" className="w-full"><SelectValue /></SelectTrigger>
                  <SelectContent>{choices.map((a) => <SelectItem key={a.id} value={a.id}>{nameOf(a)}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            )}
            <div className="grid gap-2">
              <Label htmlFor="extract-date">Due Date</Label>
              <Popover open={dateOpen} onOpenChange={setDateOpen}>
                <PopoverTrigger asChild>
                  <Button id="extract-date" type="button" variant="outline" className="min-w-0 justify-between font-normal">
                    <span className="truncate">{fromDateKey(date)?.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric" }) ?? "No Date"}</span>
                    <ChevronDownIcon className="text-muted-foreground" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto overflow-hidden p-0" align="start">
                  <Calendar mode="single" selected={fromDateKey(date)} defaultMonth={fromDateKey(date)} weekStartsOn={1} captionLayout="dropdown" onSelect={(d) => { if (d) setDate(dayKey(d)); setDateOpen(false); }} />
                </PopoverContent>
              </Popover>
            </div>
          </div>
        )}
        {!noTaskList && items.length > 0 && (
          <div className={DIALOG_BUTTONS}>
            <Button type="button" disabled={picked.size === 0 || !date} onClick={submit}>{picked.size === 1 ? "Make 1 Task" : `Make ${picked.size} Tasks`}</Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
