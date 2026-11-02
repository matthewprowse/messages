"use client";

// The New Task dialog, which also edits a task. The task shows at once and the worker saves it to the task provider.

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ChevronDownIcon } from "lucide-react";
import { markSubmitted } from "@/lib/analytics";
import { useApp } from "@/lib/store";
import { dateKey } from "@/lib/new-items";
import { dateOnly, formOfTask, MAX_NOTES, MAX_TITLE, taskChanged, taskProblem, TASK_PROVIDERS, TASK_PROVIDER_NAMES, timeChoices, type TaskForm } from "@/lib/tasks";
import type { Task } from "@/lib/types";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

const NO_TIME = "none";
const PRIORITIES = [{ value: "0", label: "None" }, { value: "1", label: "High" }, { value: "2", label: "Medium" }, { value: "3", label: "Low" }];

function fromDateKey(key: string) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key);
  return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : undefined;
}

const EMPTY: TaskForm = { title: "", notes: "", accountId: "", date: "", time: "", priority: 0 };

/**
 * A new task in Microsoft To Do, Google Tasks or iCloud Reminders, or with `editing` a change to one. Saving closes
 * the dialog at once: the page shows the task meanwhile (store.tsx createTask and editTask) and the worker makes it
 * at the provider, putting the task back as it was with a message if it cannot.
 */
export function NewTaskDialog({ open, onOpenChange, editing }: { open: boolean; onOpenChange: (open: boolean) => void; editing?: Task }) {
  const { accounts, createTask, editTask } = useApp();
  const choices = useMemo(() => accounts.filter((a) => (TASK_PROVIDERS as readonly string[]).includes(a.provider) && a.status !== "disconnected"), [accounts]);
  const [form, setForm] = useState<TaskForm>(EMPTY);
  const [dateOpen, setDateOpen] = useState(false);
  const [checked, setChecked] = useState(false);
  const edit = !!editing;

  // Each time it opens it starts fresh: empty on the first account, or filled with the task being changed.
  useEffect(() => {
    if (!open) return;
    setChecked(false);
    setDateOpen(false);
    setForm(editing ? formOfTask(editing) : { ...EMPTY, accountId: choices[0]?.id ?? "", date: dateKey(new Date()) });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, editing?.id]);

  const account = accounts.find((a) => a.id === (form.accountId || editing?.accountId));
  const dateless = dateOnly(account?.provider);
  const problem = taskProblem(form);
  const unchanged = !!editing && !taskChanged(form, editing);
  const set = (patch: Partial<TaskForm>) => setForm((f) => ({ ...f, ...patch }));
  const errorFor = (field: string) => (checked && problem?.field === field ? problem.text : null);

  const nameOf = (a: (typeof choices)[number]) => {
    const name = TASK_PROVIDER_NAMES[a.provider] ?? a.provider;
    return choices.filter((c) => c.provider === a.provider).length > 1 && a.detail ? `${name} (${a.detail})` : name;
  };

  const submit = () => {
    setChecked(true);
    if (problem || !account || (edit && unchanged)) return;
    markSubmitted(edit ? "edit_task" : "new_task");
    if (editing) editTask(editing, form);
    else createTask(form);
    onOpenChange(false);
  };

  const times = useMemo(() => timeChoices(form.time), [form.time]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent track={edit ? "edit_task" : "new_task"} className="max-h-[calc(100svh-2rem)] overflow-y-auto sm:max-w-lg" showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>{edit ? "Edit Task" : "New Task"}</DialogTitle>
          {(edit || choices.length > 0) && <DialogDescription>{edit ? "Changed" : "Created"} in your task list, then shown on the Calendar page.</DialogDescription>}
        </DialogHeader>
        {!edit && choices.length === 0 ? (
          <Alert>
            <AlertTitle>Connect a task list to add tasks</AlertTitle>
            <AlertDescription>
              <p>
                Open <Link href="/settings/accounts" className="text-foreground underline underline-offset-2">Settings, Connected Accounts</Link>, connect Microsoft To Do, Google Tasks or iCloud Reminders, then try again.
              </p>
            </AlertDescription>
          </Alert>
        ) : (
          <form className="grid gap-4" onSubmit={(e) => { e.preventDefault(); submit(); }}>
            <div className="grid gap-2">
              <Label htmlFor="task-title">Title</Label>
              <Input id="task-title" value={form.title} maxLength={MAX_TITLE + 1} onChange={(e) => set({ title: e.target.value })} aria-invalid={!!errorFor("title")} autoFocus />
              {errorFor("title") && <p className="text-xs text-destructive">{errorFor("title")}</p>}
            </div>
            <div className="grid gap-2">
              <Label htmlFor="task-notes">Notes</Label>
              <Textarea id="task-notes" rows={3} value={form.notes} maxLength={MAX_NOTES + 1} onChange={(e) => set({ notes: e.target.value })} aria-invalid={!!errorFor("notes")} className="max-h-60" />
              {errorFor("notes") && <p className="text-xs text-destructive">{errorFor("notes")}</p>}
            </div>
            {!edit && choices.length > 1 && (
              <div className="grid gap-2">
                <Label htmlFor="task-account">Account</Label>
                <Select value={form.accountId} onValueChange={(v) => set({ accountId: v })}>
                  <SelectTrigger id="task-account" className="w-full"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {choices.map((a) => <SelectItem key={a.id} value={a.id}>{nameOf(a)}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            )}
            <div className="grid gap-2">
              <Label htmlFor="task-date">Due Date</Label>
              <div className="flex gap-2">
                <Popover open={dateOpen} onOpenChange={setDateOpen}>
                  <PopoverTrigger asChild>
                    <Button id="task-date" type="button" variant="outline" className="min-w-0 flex-1 justify-between font-normal" aria-invalid={!!errorFor("date")}>
                      <span className={form.date ? "truncate" : "truncate text-muted-foreground"}>
                        {fromDateKey(form.date)?.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric" }) ?? "No Date"}
                      </span>
                      <ChevronDownIcon className="text-muted-foreground" />
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto overflow-hidden p-0" align="start">
                    <Calendar
                      mode="single"
                      selected={fromDateKey(form.date)}
                      defaultMonth={fromDateKey(form.date)}
                      weekStartsOn={1}
                      captionLayout="dropdown"
                      onSelect={(d) => {
                        if (d) set({ date: dateKey(d) });
                        setDateOpen(false);
                      }}
                    />
                  </PopoverContent>
                </Popover>
              </div>
              {errorFor("date") && <p className="text-xs text-destructive">{errorFor("date")}</p>}
            </div>
            {dateless ? (
              <p className="text-xs text-muted-foreground">Google Tasks keeps only the date.</p>
            ) : (
              <div className="grid gap-2">
                <Label htmlFor="task-time">Time</Label>
                <Select value={form.time || NO_TIME} onValueChange={(v) => set({ time: v === NO_TIME ? "" : v })} disabled={!form.date}>
                  <SelectTrigger id="task-time" className="w-full tabular-nums"><SelectValue /></SelectTrigger>
                  <SelectContent className="max-h-72">
                    <SelectItem value={NO_TIME}>No Time</SelectItem>
                    {times.map((t) => <SelectItem key={t} value={t} className="tabular-nums">{t}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            )}
            {!dateless && (
              <div className="grid gap-2">
                <Label htmlFor="task-priority">Priority</Label>
                <Select value={String(form.priority)} onValueChange={(v) => set({ priority: Number(v) as TaskForm["priority"] })}>
                  <SelectTrigger id="task-priority" className="w-full"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {PRIORITIES.map((p) => <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            )}
            <DialogFooter>
              <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
              <Button type="submit" variant="secondary" disabled={!account || unchanged || (checked && !!problem)}>{edit ? "Save" : "Create"}</Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
