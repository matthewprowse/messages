"use client";

import { createContext, Fragment, Suspense, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { ArrowLeft, ArrowRight, CalendarDays, Circle, CircleCheck } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { useApp } from "@/lib/store";
import { buildResponse, canChangeEvents, dayKey, daysOf, eventDetail, followUpdate, googleEventUrl, loadEventDetail, loadEvents, withPatch, type CalendarEvent, type EventPatch, type EventResponse, type UpdateScope } from "@/lib/calendar";
import { describeRule } from "@/lib/recurrence";
import { supabase } from "@/lib/supabase";
import { timeOf } from "@/lib/format";
import { isOverdue, isTempTask, taskDetail, tasksByDay, taskWhen, type DayTask } from "@/lib/tasks";
import type { Task } from "@/lib/types";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { PaneControls, PaneHeader, SearchBand, ViewButtons } from "@/components/pane";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { EmptyState, providerLabel } from "@/components/primitives";
import { NewEventDialog } from "@/components/new-event-dialog";
import { NewTaskDialog } from "@/components/new-task-dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { DeleteEventDialog, type DeleteScope } from "@/components/delete-event-dialog";
import { DIALOG_BUTTONS } from "@/components/merge-dialog";
import { EventMeetings } from "@/components/meeting-card";

type View = "agenda" | "day" | "week";

const HOUR = 48; // height of an hour in the week view, in pixels
const MIN_EVENT = 20; // shortest an event is drawn, in minutes, so its title fits
const MAX_COLUMNS = 3; // events that overlap share a day's width up to this many ways
const LABELS = 56; // width of the hour labels, in pixels
const DAY_MIN = 80; // narrowest a day column in the week view is allowed to be, in pixels

function startOfDay(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function addDays(d: Date, n: number) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
}

/** The Monday of the week the day falls in. */
function startOfWeek(d: Date) {
  return addDays(startOfDay(d), -((d.getDay() + 6) % 7));
}

function startOfMonth(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

function fromKey(key: string) {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(y, m - 1, d);
}

/** A "YYYY-MM-DD" from the address bar as a date, or undefined when it is not a real one. */
function parseKey(key: string | null) {
  if (!key || !/^\d{4}-\d{2}-\d{2}$/.test(key)) return undefined;
  const d = fromKey(key);
  return dayKey(d) === key ? d : undefined;
}

function pad(n: number) {
  return String(n).padStart(2, "0");
}

function dayTitle(key: string, today: Date) {
  if (key === dayKey(today)) return "Today";
  if (key === dayKey(addDays(today, 1))) return "Tomorrow";
  if (key === dayKey(addDays(today, -1))) return "Yesterday";
  const d = fromKey(key);
  return d.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", ...(d.getFullYear() !== today.getFullYear() ? { year: "numeric" } : {}) });
}

function rangeLabel(start: Date, end: Date, today: Date) {
  const last = addDays(end, -1);
  const sameMonth = start.getMonth() === last.getMonth() && start.getFullYear() === last.getFullYear();
  const from = start.toLocaleDateString("en-GB", sameMonth ? { day: "numeric" } : { day: "numeric", month: "short" });
  const to = last.toLocaleDateString("en-GB", { day: "numeric", month: "short", ...(last.getFullYear() !== today.getFullYear() ? { year: "numeric" } : {}) });
  return start.getTime() === last.getTime() ? to : `${from} to ${to}`;
}

/** "09:00 to 10:00", or the end day as well when the event runs past midnight. */
function timeRange(e: CalendarEvent) {
  if (e.allDay) return "All Day";
  const start = timeOf(e.startsAt);
  if (!e.endsAt || e.endsAt === e.startsAt) return start;
  const sameDay = dayKey(new Date(e.startsAt)) === dayKey(new Date(e.endsAt));
  const end = sameDay ? timeOf(e.endsAt) : `${new Date(e.endsAt).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" })}, ${timeOf(e.endsAt)}`;
  return `${start} to ${end}`;
}

/** "09:00 to 10:00" for a chip, where the end day does not fit. */
function chipRange(e: CalendarEvent) {
  return e.endsAt && e.endsAt !== e.startsAt ? `${timeOf(e.startsAt)} to ${timeOf(e.endsAt)}` : timeOf(e.startsAt);
}

/** All-day events first, then by start time. */
function byTime(a: CalendarEvent, b: CalendarEvent) {
  return Number(b.allDay) - Number(a.allDay) || a.startsAt.localeCompare(b.startsAt) || a.title.localeCompare(b.title);
}

/** Over already (an all-day event counts until its last day is done), or declined: drawn dimmer. */
function isDimmed(e: CalendarEvent, now: Date) {
  if (e.response === "declined") return true;
  if (e.allDay) {
    const first = e.startsAt.slice(0, 10);
    const end = e.endsAt ? e.endsAt.slice(0, 10) : null;
    const today = dayKey(now);
    return end && end > first ? today >= end : today > first;
  }
  return new Date(e.endsAt ?? e.startsAt).getTime() < now.getTime();
}

const WIDE = "(min-width: 768px)";

/** True from the md breakpoint up, where the page is a split and not one scrolling column. */
function useWide() {
  return useSyncExternalStore(
    (notify) => {
      const query = window.matchMedia(WIDE);
      query.addEventListener("change", notify);
      return () => query.removeEventListener("change", notify);
    },
    () => window.matchMedia(WIDE).matches,
    () => true,
  );
}

interface PageContext {
  wide: boolean;
  now: Date;
  /** Which event's details are open, as "id|day", so an event shown on several days opens once. */
  openKey: string | null;
  setOpenKey: (key: string | null) => void;
  /** Events with their guests, notes and link, fetched when opened. */
  details: Map<string, CalendarEvent>;
  detailsFailed: Set<string>;
  /** Asks the page to delete an event. The page owns the confirmation. */
  askToDelete: (event: CalendarEvent) => void;
  /** Opens the editor for an event. */
  askToEdit: (event: CalendarEvent) => void;
  /** Answers an invitation. The page shows the answer at once while the calendar takes it. */
  answer: (event: CalendarEvent, response: EventResponse) => void;
  /** Opens a task's details. */
  openTask: (id: string) => void;
  /** Where a task is from, such as "Google Tasks". */
  sourceOf: (task: Task) => string | undefined;
}

const Page = createContext<PageContext>({
  wide: true,
  now: new Date(),
  openKey: null,
  setOpenKey: () => undefined,
  details: new Map(),
  detailsFailed: new Set(),
  askToDelete: () => undefined,
  askToEdit: () => undefined,
  answer: () => undefined,
  openTask: () => undefined,
  sourceOf: () => undefined,
});

function Attendees({ event }: { event: CalendarEvent }) {
  if (event.attendees.length === 0) return null;
  return (
    <p className="text-muted-foreground">
      {event.attendees.map((a, i) => (
        <Fragment key={a.email}>
          {i > 0 && ", "}
          {a.contactId ? (
            <Link href={`/contacts/${a.contactId}`} className="text-foreground underline-offset-2 hover:underline">{a.name}</Link>
          ) : (
            <span>{a.name}</span>
          )}
        </Fragment>
      ))}
    </p>
  );
}

const RESPONSES: Record<string, string> = { accepted: "Accepted", tentative: "Maybe", declined: "Declined", needsAction: "Not Answered" };

/**
 * How an event repeats, in words, from its series' rule. An event the calendar gives no rule for (Outlook, or one
 * the worker has not read the rule of yet) just says that it does.
 */
function repeatsText(e: CalendarEvent) {
  if (!e.recurrence) return "Yes";
  const words = describeRule(e.recurrence, new Date(e.startsAt));
  return words === "Repeats" ? "On a Custom Schedule" : words;
}

/** A label and what it says, in the details' two columns. */
function Detail({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0 break-words">{children}</dd>
    </>
  );
}

const YOUR_ANSWER: Record<string, EventResponse> = { accepted: "accepted", tentative: "tentative", declined: "declined" };

/** What the app knows about an opened event, and what can be done with it here. */
function useEventState(event: CalendarEvent) {
  const { accounts } = useApp();
  const { details, detailsFailed } = useContext(Page);
  const full = details.get(event.id) ?? event;
  const loading = !full.detailed && !detailsFailed.has(event.id);
  const provider = accounts.find((a) => a.id === full.accountId)?.provider;
  return {
    full,
    loading,
    // Events still being created have no account yet, and Outlook Calendar cannot delete.
    canDelete: provider === "google_calendar" || provider === "icloud_calendar",
    // Details of an event someone else invited you to are theirs to change; you can only answer.
    canEdit: canChangeEvents(provider) && !full.organizer && !full.pending,
    canReply: canChangeEvents(provider) && !!full.organizer && full.response != null && full.attendees.length > 0,
    link: provider === "google_calendar" ? googleEventUrl(full) : null,
  };
}

/** When an event is, as the dialog's description: its day, then its times. */
function eventWhen(e: CalendarEvent) {
  const day = (e.allDay ? new Date(`${e.startsAt.slice(0, 10)}T12:00:00`) : new Date(e.startsAt)).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
  return `${day}, ${timeRange(e)}`;
}

/** Everything the app has about an event, with Join for a meeting link and Reply where the calendar allows it. */
function EventDetails({ event }: { event: CalendarEvent }) {
  const { answer, detailsFailed } = useContext(Page);
  const { full, loading, canReply } = useEventState(event);
  return (
    <div className="flex min-w-0 flex-col gap-4">
      {full.pending && <span className="text-sm text-muted-foreground">Saving</span>}
      {full.conferenceUrl && (
        <Button asChild className="self-start">
          <a href={full.conferenceUrl} target="_blank" rel="noreferrer">Join Meeting</a>
        </Button>
      )}
      <dl className="grid grid-cols-[5rem_minmax(0,1fr)] items-baseline gap-x-3 gap-y-3 text-sm">
        {full.location && <Detail label="Location">{full.location}</Detail>}
        {full.calendarName && <Detail label="Calendar">{full.calendarName}</Detail>}
        {(full.seriesId || full.recurrence) && <Detail label="Repeats">{repeatsText(full)}</Detail>}
        {full.organizer && <Detail label="Organizer">{full.organizer.name}</Detail>}
        {full.response && (
          <Detail label="Reply">
            {canReply ? (
              <ToggleGroup
                type="single"
                variant="outline"
                aria-label="Your reply"
                value={YOUR_ANSWER[full.response] ?? ""}
                disabled={loading || full.pending}
                onValueChange={(value) => value && answer(full, value as EventResponse)}
              >
                <ToggleGroupItem value="accepted" aria-label="Yes">Yes</ToggleGroupItem>
                <ToggleGroupItem value="tentative" aria-label="Maybe">Maybe</ToggleGroupItem>
                <ToggleGroupItem value="declined" aria-label="No">No</ToggleGroupItem>
              </ToggleGroup>
            ) : (
              (RESPONSES[full.response] ?? full.response)
            )}
          </Detail>
        )}
        {full.attendees.length > 0 && (
          <Detail label="Guests">
            <Attendees event={full} />
          </Detail>
        )}
        {full.description && (
          <Detail label="Notes">
            <span className="block max-h-40 overflow-y-auto whitespace-pre-line">{full.description}</span>
          </Detail>
        )}
      </dl>
      {loading && (
        <div className="flex flex-col gap-2" aria-label="Loading details">
          <Skeleton className="h-4 w-2/3" />
          <Skeleton className="h-4 w-1/2" />
        </div>
      )}
      {!full.detailed && detailsFailed.has(event.id) && <p className="text-sm text-muted-foreground">Guests and notes did not load.</p>}
      <EventMeetings eventId={full.pending ? null : full.id} />
    </div>
  );
}

/**
 * An event's details in a dialog, from any view and on any screen: Edit, Delete and the link to the calendar in
 * its button row, where the calendar allows them.
 */
function EventDialog({ event, onClose }: { event: CalendarEvent | null; onClose: () => void }) {
  // The last event stays drawn while the dialog animates closed.
  const last = useRef<CalendarEvent | null>(null);
  if (event) last.current = event;
  const shown = event ?? last.current;
  return (
    <Dialog open={!!event} onOpenChange={(open) => !open && onClose()}>
      <DialogContent track="event_details" showCloseButton closeVariant="secondary" className="max-h-[calc(100svh-2rem)] overflow-y-auto sm:max-w-lg">
        {shown && <EventDialogBody event={shown} onClose={onClose} />}
      </DialogContent>
    </Dialog>
  );
}

function EventDialogBody({ event, onClose }: { event: CalendarEvent; onClose: () => void }) {
  const { askToDelete, askToEdit } = useContext(Page);
  const { full, loading, canDelete, canEdit, link } = useEventState(event);
  return (
    <>
      <DialogHeader className="pr-10">
        <DialogTitle className="break-words">{full.title}</DialogTitle>
        <DialogDescription className="tabular-nums">{eventWhen(full)}</DialogDescription>
      </DialogHeader>
      <EventDetails event={event} />
      <div className={DIALOG_BUTTONS}>
        {link && (
          <Button variant="ghost" asChild>
            <a href={link} target="_blank" rel="noopener noreferrer">Open in Google Calendar</a>
          </Button>
        )}
        {canDelete && <Button variant="ghost" disabled={loading} onClick={() => { onClose(); askToDelete(full); }}>Delete</Button>}
        {canEdit && <Button variant="secondary" disabled={loading || !full.detailed} onClick={() => { onClose(); askToEdit(full); }}>Edit</Button>}
      </div>
    </>
  );
}

/** Gives the element it renders a click that opens the event's details. */
function EventSurface({ event, day, render }: { event: CalendarEvent; day: string; render: (onClick: () => void) => React.ReactNode }) {
  const { setOpenKey } = useContext(Page);
  return <>{render(() => setOpenKey(`${event.id}|${day}`))}</>;
}

/** An event in the week grid; clicking it shows everything about it. */
function EventChip({ event, day, className, style, children }: { event: CalendarEvent; day: string; className?: string; style?: React.CSSProperties; children: React.ReactNode }) {
  const { now } = useContext(Page);
  const faded = event.pending || isDimmed(event, now);
  return (
    <EventSurface
      event={event}
      day={day}
      render={(onClick) => (
        <button
          type="button"
          onClick={onClick}
          style={style}
          className={cn("min-w-0 overflow-hidden rounded-md bg-secondary text-left text-xs text-secondary-foreground transition-colors outline-none hover:bg-accent focus-visible:ring-3 focus-visible:ring-ring/50", faded && "opacity-60", className)}
        >
          {children}
        </button>
      )}
    />
  );
}

// ---------------------------------------------------------------------------
// Tasks: a checkbox and the title, outlined rather than filled so they read apart from events. Ticking one
// shows at once while the worker makes it at the provider; the list and source are on hover and in details.
// ---------------------------------------------------------------------------

const PRIORITIES: Record<number, string> = { 1: "High", 2: "Medium", 3: "Low" };

/** "Due Friday, 30 October 2026", with the time for a timed task. */
function taskDue(task: Task) {
  if (!task.dueAt) return "No Due Date";
  const day = (task.dueAllDay ? new Date(`${task.dueAt.slice(0, 10)}T12:00:00`) : new Date(task.dueAt)).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
  return task.dueAllDay ? `Due ${day}` : `Due ${day}, ${timeOf(task.dueAt)}`;
}

function TaskCheckbox({ task, via }: { task: Task; via: "calendar" | "details" }) {
  const { tickTask } = useApp();
  return <Checkbox checked={task.completed} onCheckedChange={(checked) => tickTask(task, checked === true, via)} disabled={isTempTask(task)} aria-label={task.title} />;
}

/** A task in the week grid: in the all-day row, or as a short item at its time. Clicking the title shows its details. */
function TaskChip({ item, className, style }: { item: DayTask; className?: string; style?: React.CSSProperties }) {
  const { openTask, sourceOf } = useContext(Page);
  const { task, overdue } = item;
  return (
    <div
      style={style}
      title={[overdue && "Overdue", task.listName, sourceOf(task)].filter(Boolean).join(" · ") || undefined}
      className={cn("flex min-w-0 items-center gap-1.5 overflow-hidden rounded-md border bg-background px-1.5 text-xs", (task.completed || task.pending) && "opacity-60", className)}
    >
      <TaskCheckbox task={task} via="calendar" />
      <button
        type="button"
        onClick={() => openTask(task.id)}
        className={cn("min-w-0 flex-1 truncate text-left font-medium outline-none hover:underline focus-visible:underline", task.completed && "line-through", overdue && "text-destructive")}
      >
        {task.title}
      </button>
    </div>
  );
}

/** A task in the list, laid out like an event row with its checkbox where the icon goes. */
function TaskRow({ item }: { item: DayTask }) {
  const { openTask, sourceOf } = useContext(Page);
  const { task, overdue } = item;
  return (
    <div className={cn("flex w-full items-center gap-3 rounded-lg p-3 hover:bg-muted/50", (task.completed || task.pending) && "opacity-60")}>
      <div className="flex size-8 shrink-0 items-center justify-center">
        <TaskCheckbox task={task} via="calendar" />
      </div>
      <button type="button" onClick={() => openTask(task.id)} className="flex min-w-0 flex-1 flex-col gap-1 rounded-sm text-left outline-none focus-visible:ring-2 focus-visible:ring-ring/50">
        <div className="flex h-5 w-full items-center justify-between gap-3">
          <span className={cn("min-w-0 truncate text-sm font-medium", task.completed && "line-through")}>{task.title}</span>
          <span className={cn("shrink-0 text-xs tabular-nums text-muted-foreground", overdue && !task.pending && "text-destructive")}>{taskWhen(item, timeOf)}</span>
        </div>
        <div className="flex h-4 items-center">
          <span className="min-w-0 truncate text-xs">{taskDetail(task, sourceOf(task))}</span>
        </div>
      </button>
    </div>
  );
}

/** Everything the app has about a task, with Mark as Done (or Not Done) in its button row. */
function TaskDialog({ task, onClose, onEdit }: { task: Task | null; onClose: () => void; onEdit: (task: Task) => void }) {
  // The last task stays drawn while the dialog animates closed.
  const last = useRef<Task | null>(null);
  if (task) last.current = task;
  const shown = task ?? last.current;
  return (
    <Dialog open={!!task} onOpenChange={(open) => !open && onClose()}>
      <DialogContent track="task_details" showCloseButton className="max-h-[calc(100svh-2rem)] overflow-y-auto sm:max-w-lg">
        {shown && <TaskDialogBody task={shown} onClose={onClose} onEdit={onEdit} />}
      </DialogContent>
    </Dialog>
  );
}

function TaskDialogBody({ task, onClose, onEdit }: { task: Task; onClose: () => void; onEdit: (task: Task) => void }) {
  const { now, sourceOf } = useContext(Page);
  const { contactById, tickTask, deleteTask } = useApp();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const saved = !isTempTask(task);
  const contact = task.contactId ? contactById(task.contactId) : undefined;
  const source = sourceOf(task);
  return (
    <>
      <DialogHeader>
        <DialogTitle className={cn("break-words", task.completed && "line-through")}>{task.title}</DialogTitle>
        <DialogDescription className="tabular-nums">{taskDue(task)}</DialogDescription>
      </DialogHeader>
      <div className="flex min-w-0 flex-col gap-4">
        {task.pending && <span className="text-sm text-muted-foreground">Saving</span>}
        <dl className="grid grid-cols-[5rem_minmax(0,1fr)] items-baseline gap-x-3 gap-y-3 text-sm">
          <Detail label="Status">{task.completed ? "Done" : isOverdue(task, now) ? <span className="text-destructive">Overdue</span> : "To Do"}</Detail>
          {task.listName && <Detail label="List">{task.listName}</Detail>}
          {source && <Detail label="Source">{source}</Detail>}
          {contact && (
            <Detail label="Contact">
              <Link href={`/contacts/${contact.id}`} className="underline-offset-2 hover:underline">{contact.name}</Link>
            </Detail>
          )}
          {task.priority && <Detail label="Priority">{PRIORITIES[task.priority]}</Detail>}
          {task.notes && (
            <Detail label="Notes">
              <span className="block max-h-40 overflow-y-auto whitespace-pre-line">{task.notes}</span>
            </Detail>
          )}
        </dl>
      </div>
      <div className={DIALOG_BUTTONS}>
        {saved && <Button variant="ghost" onClick={() => setConfirmDelete(true)}>Delete</Button>}
        {saved && <Button variant="secondary" onClick={() => onEdit(task)}>Edit</Button>}
        <Button variant="secondary" disabled={!saved} onClick={() => tickTask(task, !task.completed, "details")}>{task.completed ? "Mark as Not Done" : "Mark as Done"}</Button>
      </div>
      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent track="delete_task">
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Task?</AlertDialogTitle>
            <AlertDialogDescription>This deletes the task in {source ?? "your task list"} as well.</AlertDialogDescription>
          </AlertDialogHeader>
          <div className={DIALOG_BUTTONS}>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction variant="secondary" onClick={() => { deleteTask(task); onClose(); }}>Delete</AlertDialogAction>
          </div>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

/** A timed task in a day column, laid out with the events so neither covers the other. It takes TASK_MINUTES, room for its checkbox. */
type TaskSlot = { id: string; startsAt: string; endsAt: string; item: DayTask };

const TASK_MINUTES = 30;

function taskSlot(item: DayTask): TaskSlot {
  const at = item.task.dueAt!;
  return { id: item.task.id, startsAt: at, endsAt: new Date(Date.parse(at) + TASK_MINUTES * 60_000).toISOString(), item };
}

const isSlot = (x: CalendarEvent | TaskSlot): x is TaskSlot => "item" in x;

/**
 * Where each timed event sits in a day column: minutes from midnight, and which of how many side by
 * side columns it takes when it overlaps others. Beyond MAX_COLUMNS side by side the rest are left out of the
 * grid (they are still in the list) and counted in `more`. `from` is the first minute drawn.
 */
function layoutDay<T extends { startsAt: string; endsAt: string | null }>(key: string, events: T[], from = 0) {
  const dayStart = fromKey(key).getTime();
  const all = events
    .map((event) => {
      const start = new Date(event.startsAt).getTime();
      const end = event.endsAt ? new Date(event.endsAt).getTime() : start;
      const top = Math.max(from, (start - dayStart) / 60_000);
      const bottom = Math.max(top + MIN_EVENT, Math.min(1440, (end - dayStart) / 60_000));
      return { event, top, bottom: Math.min(1440, bottom), col: 0, cols: 1, hidden: false };
    })
    .sort((a, b) => a.top - b.top || b.bottom - a.bottom);

  // Events that overlap, directly or through each other, share the width of the column.
  const more: { top: number; count: number }[] = [];
  let cluster: typeof all = [];
  let clusterEnd = -1;
  const finish = () => {
    const shown = cluster.filter((i) => !i.hidden);
    const cols = Math.max(0, ...shown.map((i) => i.col)) + 1;
    for (const i of shown) i.cols = cols;
    const hiddenCount = cluster.length - shown.length;
    if (hiddenCount) more.push({ top: Math.min(...cluster.filter((i) => i.hidden).map((i) => i.top)), count: hiddenCount });
  };
  for (const item of all) {
    if (item.top >= clusterEnd && cluster.length) {
      finish();
      cluster = [];
    }
    const taken = new Set(cluster.filter((i) => !i.hidden && i.bottom > item.top).map((i) => i.col));
    let col = 0;
    while (taken.has(col)) col++;
    item.col = col;
    item.hidden = col >= MAX_COLUMNS;
    cluster.push(item);
    clusterEnd = Math.max(clusterEnd, item.bottom);
  }
  if (cluster.length) finish();
  return { items: all.filter((i) => !i.hidden), more };
}

function hourLabel(h: number) {
  return `${pad(h)}:00`;
}

const SNAP = 15; // minutes a dragged-out new event snaps to

/** The new event being dragged out, with the times it will have. */
function DragPreview({ from, to, offset }: { from: number; to: number; offset: number }) {
  const start = Math.min(from, to);
  const end = Math.min(Math.max(from, to, start + SNAP), 1440 - SNAP);
  return (
    <div
      className="pointer-events-none absolute inset-x-0.5 z-10 flex flex-col rounded-md border border-primary bg-primary/15 px-1.5 py-1 text-xs"
      style={{ top: (start / 60) * HOUR - offset + 1, height: ((end - start) / 60) * HOUR - 2 }}
    >
      <span className="truncate tabular-nums">{minutesLabel(start)} to {minutesLabel(end)}</span>
    </div>
  );
}

/** "HH:MM" for minutes from midnight. */
function minutesLabel(m: number) {
  return `${pad(Math.floor(m / 60))}:${pad(m % 60)}`;
}

/**
 * The days across with the hours down the side, like Apple Calendar's week. As many days as fit: seven on a wide
 * screen, fewer on a phone. Below md the page scrolls (the day names stick to the top) and the hours before the
 * first event are left out; from md up the hours scroll inside the pane.
 */
function WeekView({
  days,
  byDay,
  tasksByDay: dayTasks,
  today,
  now,
  selectedKey,
  inline,
  onSelectDay,
  onCreateAt,
}: {
  days: string[];
  byDay: Map<string, CalendarEvent[]>;
  tasksByDay: Map<string, DayTask[]>;
  today: Date;
  now: Date;
  selectedKey: string;
  inline: boolean;
  onSelectDay: (key: string) => void;
  /** A new event on that day from `time`, an hour long or to `until`. */
  onCreateAt: (key: string, time: string, until?: string) => void;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  // A new event being dragged out in a day: the minutes it was started at and has reached.
  const [drag, setDrag] = useState<{ key: string; from: number; to: number } | null>(null);
  const pointerType = useRef("");
  const todayKey = dayKey(today);
  const nowMinutes = now.getHours() * 60 + now.getMinutes();
  const allDay = days.map((key) => (byDay.get(key) ?? []).filter((e) => e.allDay));
  const allDayTasks = days.map((key) => (dayTasks.get(key) ?? []).filter((t) => !t.timed));
  const hasAllDay = allDay.some((list) => list.length > 0) || allDayTasks.some((list) => list.length > 0);
  const nowHour = now.getHours();

  // Opens an hour before now in today's week, else at 08:00, or earlier when an event this week starts earlier.
  const firstHour = useMemo(() => {
    const earliest = Math.min(
      24,
      ...days.flatMap((key) => (byDay.get(key) ?? []).filter((e) => !e.allDay && dayKey(new Date(e.startsAt)) === key).map((e) => new Date(e.startsAt).getHours())),
      ...days.flatMap((key) => (dayTasks.get(key) ?? []).filter((t) => t.timed && t.task.dueAt).map((t) => new Date(t.task.dueAt!).getHours())),
    );
    return Math.max(0, Math.min(earliest, days.includes(todayKey) ? Math.max(0, nowHour - 1) : 8, 23));
  }, [days, byDay, dayTasks, todayKey, nowHour]);
  // Where the drawing starts: the top of the day, or in the page-scrolling layout the first hour shown.
  const offset = inline ? firstHour * HOUR : 0;

  useLayoutEffect(() => {
    const el = scrollRef.current;
    // A little higher than the hour, so its label is not cut off under the day names.
    if (el && !inline) el.scrollTop = Math.max(0, firstHour * HOUR - 12);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [days[0], inline]);

  const hours = Array.from({ length: 23 - firstHour * Number(inline) }, (_, i) => i + 1 + firstHour * Number(inline));
  /** Minutes from midnight at the pointer, in the day column the event belongs to. */
  const minuteAt = (e: React.MouseEvent<HTMLElement>) => {
    const y = e.clientY - e.currentTarget.getBoundingClientRect().top + offset;
    return Math.max(0, Math.min(1440 - SNAP, (y / HOUR) * 60));
  };

  return (
    <div className="flex flex-col md:h-full">
      <div className="sticky top-0 z-20 shrink-0 bg-background md:static">
        <div className="flex border-b md:overflow-y-hidden md:[scrollbar-gutter:stable]">
          <div className="shrink-0" style={{ width: LABELS }} />
          {days.map((key) => {
            const d = fromKey(key);
            const isToday = key === todayKey;
            const isSelected = key === selectedKey;
            return (
              <button
                key={key}
                type="button"
                onClick={() => onSelectDay(key)}
                aria-pressed={isSelected}
                aria-label={d.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" })}
                className={cn(
                  "flex min-h-11 min-w-0 flex-1 items-center justify-center gap-1.5 py-2 text-sm outline-none transition-colors hover:bg-muted/50 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:ring-inset md:min-h-0",
                  isSelected && "bg-muted hover:bg-muted",
                )}
              >
                <span className="text-muted-foreground">{d.toLocaleDateString("en-GB", { weekday: "short" })}</span>
                <span className={cn("flex size-7 items-center justify-center rounded-full tabular-nums", isToday && "bg-primary font-medium text-primary-foreground")}>{d.getDate()}</span>
              </button>
            );
          })}
        </div>
        {hasAllDay && (
          <div className="flex border-b md:overflow-y-hidden md:[scrollbar-gutter:stable]">
            <div className="shrink-0 py-1.5 pr-2 text-right text-xs text-muted-foreground" style={{ width: LABELS }}>All Day</div>
            {days.map((key, i) => (
              <div key={key} className="flex min-w-0 flex-1 flex-col gap-1 border-l p-1">
                {allDay[i].map((e) => (
                  <EventChip key={e.id} event={e} day={key} className="truncate px-1.5 py-0.5 font-medium">{e.title}</EventChip>
                ))}
                {allDayTasks[i].map((t) => <TaskChip key={t.task.id} item={t} className="py-0.5" />)}
              </div>
            ))}
          </div>
        )}
      </div>
      <div ref={scrollRef} className="md:min-h-0 md:flex-1 md:overflow-y-auto md:[scrollbar-gutter:stable]">
        <div className="relative flex" style={{ height: 24 * HOUR - offset }}>
          {/* A line across every day at each hour. */}
          {hours.map((h) => (
            <div key={h} className="pointer-events-none absolute right-0 border-t" style={{ top: h * HOUR - offset, left: LABELS }} />
          ))}
          <div className="sticky left-0 z-10 shrink-0 bg-background" style={{ width: LABELS }}>
            {inline && firstHour > 0 && (
              <span className="absolute top-0.5 right-2 text-xs tabular-nums text-muted-foreground">{hourLabel(firstHour)}</span>
            )}
            {hours.map((h) => (
              <span key={h} className="absolute right-2 -translate-y-1/2 text-xs tabular-nums text-muted-foreground" style={{ top: h * HOUR - offset }}>
                {hourLabel(h)}
              </span>
            ))}
          </div>
          {days.map((key) => {
            const timed: (CalendarEvent | TaskSlot)[] = [
              ...(byDay.get(key) ?? []).filter((e) => !e.allDay),
              ...(dayTasks.get(key) ?? []).filter((t) => t.timed && t.task.dueAt).map(taskSlot),
            ];
            const { items, more } = layoutDay(key, timed, inline ? firstHour * 60 : 0);
            return (
              <div
                key={key}
                className="relative min-w-0 flex-1 border-l select-none"
                // In the empty part of a day: drag out a new event, or double-click (or right-click) to start one at
                // that half hour. A tap on a touch screen starts one at that hour, as a drag there scrolls.
                onPointerDown={(e) => {
                  pointerType.current = e.pointerType;
                  if (e.button !== 0 || e.target !== e.currentTarget || e.pointerType === "touch") return;
                  const m = Math.floor(minuteAt(e) / SNAP) * SNAP;
                  e.currentTarget.setPointerCapture(e.pointerId);
                  setDrag({ key, from: m, to: m });
                }}
                onPointerMove={(e) => {
                  if (!drag || drag.key !== key) return;
                  const m = Math.round(minuteAt(e) / SNAP) * SNAP;
                  setDrag((d) => (d && d.key === key && d.to !== m ? { ...d, to: m } : d));
                }}
                onPointerUp={() => {
                  if (!drag || drag.key !== key) return;
                  const [a, b] = [Math.min(drag.from, drag.to), Math.max(drag.from, drag.to)];
                  setDrag(null);
                  if (b - a >= SNAP) onCreateAt(key, minutesLabel(a), minutesLabel(Math.min(b, 1440 - SNAP)));
                }}
                onPointerCancel={() => setDrag(null)}
                onDoubleClick={(e) => {
                  if (e.target === e.currentTarget) onCreateAt(key, minutesLabel(Math.floor(minuteAt(e) / 30) * 30));
                }}
                onContextMenu={(e) => {
                  if (e.target !== e.currentTarget) return;
                  e.preventDefault();
                  onCreateAt(key, minutesLabel(Math.floor(minuteAt(e) / 30) * 30));
                }}
                onClick={(e) => {
                  if (pointerType.current !== "touch" || e.target !== e.currentTarget) return;
                  onCreateAt(key, hourLabel(Math.floor(minuteAt(e) / 60)));
                }}
              >
                {drag?.key === key && <DragPreview from={drag.from} to={drag.to} offset={offset} />}
                {items.map(({ event, top, bottom, col, cols }) => {
                  const height = ((bottom - top) / 60) * HOUR;
                  const place = { top: (top / 60) * HOUR - offset + 1, height: height - 2, left: `calc(${(col / cols) * 100}% + 2px)`, width: `calc(${100 / cols}% - 4px)` };
                  if (isSlot(event)) return <TaskChip key={event.id} item={event.item} className="absolute ring-1 ring-background" style={place} />;
                  return (
                    <EventChip
                      key={event.id}
                      event={event}
                      day={key}
                      className="absolute flex flex-col px-1.5 py-1 ring-1 ring-background"
                      style={place}
                    >
                      <span className={cn("font-medium break-words", height < 40 ? "truncate" : "line-clamp-2")}>{event.title}</span>
                      {height >= 40 && <span className="truncate tabular-nums text-muted-foreground">{event.pending ? "Saving" : chipRange(event)}</span>}
                    </EventChip>
                  );
                })}
                {more.map((m) => (
                  <span key={m.top} className="pointer-events-none absolute right-0.5 z-10 rounded-sm bg-background/90 px-1 text-xs tabular-nums text-muted-foreground" style={{ top: (m.top / 60) * HOUR - offset + 1 }}>
                    +{m.count}
                  </span>
                ))}
                {key === todayKey && nowMinutes >= (inline ? firstHour * 60 : 0) && (
                  <div className="pointer-events-none absolute inset-x-0 z-10 flex items-center" style={{ top: (nowMinutes / 60) * HOUR - offset }}>
                    <span className="-ml-1 size-2 rounded-full bg-destructive" />
                    <span className="h-px flex-1 bg-destructive" />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/** The month as a grid of dates. The selected date's events are in the list beside it. */
function MonthView({
  days,
  byDay,
  tasksByDay: dayTasks,
  today,
  selected,
  monthOf,
  onSelect,
  onCreate,
}: {
  days: string[];
  byDay: Map<string, CalendarEvent[]>;
  tasksByDay: Map<string, DayTask[]>;
  today: Date;
  selected: Date;
  /** Whose month the grid shows, which follows the agenda list as it scrolls. */
  monthOf: Date;
  onSelect: (d: Date) => void;
  /** A new event on that day, from a double-click or right-click on it. */
  onCreate: (key: string) => void;
}) {
  const todayKey = dayKey(today);
  const selectedKey = dayKey(selected);
  const month = monthOf.getMonth();
  const weekdays = days.slice(0, 7).map((key) => fromKey(key).toLocaleDateString("en-GB", { weekday: "short" }));

  return (
    <div className="flex flex-col md:h-full">
      <div className="grid shrink-0 grid-cols-7 border-b">
        {weekdays.map((w) => <span key={w} className="px-2 py-2 text-right text-xs text-muted-foreground">{w}</span>)}
      </div>
      <div className="grid grid-cols-7 grid-rows-6 md:min-h-0 md:flex-1">
        {days.map((key, i) => {
          const d = fromKey(key);
          const events = byDay.get(key) ?? [];
          const tasks = dayTasks.get(key) ?? [];
          const isToday = key === todayKey;
          const isSelected = key === selectedKey;
          const outside = d.getMonth() !== month;
          const shown = events.slice(0, 3);
          const shownTasks = tasks.slice(0, Math.max(0, 3 - shown.length));
          const total = events.length + tasks.length;
          const date = d.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" });
          const counted = [
            events.length && `${events.length} ${events.length === 1 ? "event" : "events"}`,
            tasks.length && `${tasks.length} ${tasks.length === 1 ? "task" : "tasks"}`,
          ].filter(Boolean).join(", ");
          return (
            <button
              key={key}
              type="button"
              onClick={() => onSelect(d)}
              onDoubleClick={() => onCreate(key)}
              onContextMenu={(e) => { e.preventDefault(); onSelect(d); onCreate(key); }}
              aria-label={counted ? `${date}, ${counted}` : date}
              aria-pressed={isSelected}
              className={cn(
                "flex h-14 min-h-0 min-w-0 flex-col gap-0.5 overflow-hidden border-b p-1 text-left transition-colors outline-none hover:bg-muted/50 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:ring-inset md:h-auto",
                i % 7 !== 0 && "border-l",
                isSelected && "bg-muted hover:bg-muted",
              )}
            >
              <span
                className={cn(
                  "flex size-7 shrink-0 items-center justify-center self-end rounded-full text-sm tabular-nums",
                  outside && "text-muted-foreground",
                  isToday && "bg-primary font-medium text-primary-foreground",
                )}
              >
                {d.getDate()}
              </span>
              {/* Titles on wide screens, a dot on narrower ones. */}
              {total > 0 && <span className="mx-auto size-1.5 shrink-0 rounded-full bg-foreground/60 xl:hidden" />}
              <span className="hidden min-w-0 flex-col gap-0.5 xl:flex">
                {shown.map((e) => (
                  <span key={e.id} className={cn("flex min-w-0 items-center gap-1 rounded-sm px-1 text-xs", e.allDay && "bg-secondary", outside && "text-muted-foreground")}>
                    <span className="min-w-0 flex-1 truncate">{e.title}</span>
                    {!e.allDay && <span className="shrink-0 tabular-nums text-muted-foreground">{timeOf(e.startsAt)}</span>}
                  </span>
                ))}
                {shownTasks.map(({ task, overdue }) => {
                  const Icon = task.completed ? CircleCheck : Circle;
                  return (
                    <span key={task.id} className={cn("flex min-w-0 items-center gap-1 px-1 text-xs", outside && "text-muted-foreground", overdue && "text-destructive")}>
                      <Icon className="size-3 shrink-0" />
                      <span className={cn("min-w-0 flex-1 truncate", task.completed && "line-through")}>{task.title}</span>
                    </span>
                  );
                })}
                {total > shown.length + shownTasks.length && <span className="px-1 text-xs text-muted-foreground">{total - shown.length - shownTasks.length} more</span>}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

// Laid out like a Summary row: an avatar-sized icon, a title line and a detail line. Clicking one shows
// everything about the event, including who is invited.
function EventRow({ event, day }: { event: CalendarEvent; day: string }) {
  const { now } = useContext(Page);
  // A timed event that began on an earlier day is already under way.
  const when = event.pending ? "Saving" : event.allDay ? "All Day" : dayKey(new Date(event.startsAt)) < day ? "Ongoing" : timeOf(event.startsAt);
  const faded = event.pending || isDimmed(event, now);
  return (
    <EventSurface
      event={event}
      day={day}
      render={(onClick) => (
        <button
          type="button"
          onClick={onClick}
          className={cn("flex w-full items-center gap-3 rounded-lg p-3 text-left outline-none hover:bg-muted/50 focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:ring-inset", faded && "opacity-60")}
        >
          <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-muted">
            <CalendarDays className="size-4" />
          </div>
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <div className="flex h-5 items-center justify-between gap-3">
              <span className="min-w-0 truncate text-sm font-medium">{event.title}</span>
              <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{when}</span>
            </div>
            <div className="flex h-4 items-center">
              <span className="min-w-0 truncate text-xs">{eventDetail(event)}</span>
            </div>
          </div>
        </button>
      )}
    />
  );
}

// A band like the Summary's: padded, separated below, and stuck to the top while its day scrolls.
function DaySection({ day, title, count, children }: { day: string; title: string; count: number; children: React.ReactNode }) {
  return (
    <section data-day={day} className="not-first:pt-3 last:pb-3" aria-label={title}>
      <h2 className="sticky top-0 z-[5] -mx-3 flex items-center gap-2 border-b bg-background p-3 text-sm font-medium">
        <span className="flex h-8 items-center gap-2">
          {title}
          <Badge variant="secondary">{count}</Badge>
        </span>
      </h2>
      <div className="pt-3">{children}</div>
    </section>
  );
}

/** A day's events and tasks in one list: all-day events, then overdue and all-day tasks, then the rest by time. */
function dayRows(events: CalendarEvent[], tasks: DayTask[]): { id: string; event?: CalendarEvent; task?: DayTask }[] {
  const rank = (row: { event?: CalendarEvent; task?: DayTask }) => (row.event ? (row.event.allDay ? 0 : 3) : row.task!.overdue ? 1 : row.task!.timed ? 3 : 2);
  const at = (row: { event?: CalendarEvent; task?: DayTask }) => row.event?.startsAt ?? row.task!.task.dueAt ?? "";
  const rows = [...events.map((event) => ({ id: event.id, event })), ...tasks.map((task) => ({ id: task.task.id, task }))];
  return rows.sort((a, b) => rank(a) - rank(b) || Date.parse(at(a)) - Date.parse(at(b)));
}

/** The days' events as rows, a section for each day. In the month view the list follows the date picked in the grid. */
function EventList({
  keys,
  byDay,
  tasksByDay: dayTasks,
  today,
  selectedKey,
  loading,
  empty,
  onEnd,
  loadingMore,
  onVisible,
}: {
  keys: string[];
  byDay: Map<string, CalendarEvent[]>;
  tasksByDay: Map<string, DayTask[]>;
  today: Date;
  selectedKey?: string;
  loading: boolean;
  empty: React.ReactNode;
  /** Called when the end of the list scrolls into view, to load the next month. */
  onEnd?: () => void;
  loadingMore?: boolean;
  /** Called with the day at the top of the list as it is scrolled. */
  onVisible?: (key: string) => void;
}) {
  const rowsRef = useRef<HTMLDivElement>(null);
  const shownKey = useRef<string | undefined>(undefined);
  const endRef = useRef<HTMLDivElement>(null);

  // The list scrolls inside its own pane on wide screens and with the page on phones; watching the end against
  // the screen works for both.
  useEffect(() => {
    const el = endRef.current;
    if (!el || !onEnd || loading) return;
    const observer = new IntersectionObserver((entries) => { if (entries.some((e) => e.isIntersecting)) onEnd(); }, { rootMargin: "400px" });
    observer.observe(el);
    return () => observer.disconnect();
  }, [onEnd, loading]);

  // Scrolling the list reports which day is at its top, so the month above and the grid follow it.
  useEffect(() => {
    const viewport = rowsRef.current?.closest<HTMLElement>('[data-slot="scroll-area-viewport"]');
    if (!viewport || !onVisible || loading) return;
    let frame = 0;
    const onScroll = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const top = viewport.getBoundingClientRect().top + 60;
        const sections = rowsRef.current?.querySelectorAll<HTMLElement>("[data-day]") ?? [];
        for (const s of sections) {
          if (s.getBoundingClientRect().bottom > top) { onVisible(s.dataset.day!); return; }
        }
      });
    };
    viewport.addEventListener("scroll", onScroll, { passive: true });
    return () => { cancelAnimationFrame(frame); viewport.removeEventListener("scroll", onScroll); };
  }, [onVisible, loading]);

  useEffect(() => {
    // Runs again once the events load, so the list opens on the selected day.
    if (loading) return;
    const content = rowsRef.current;
    const viewport = content?.closest<HTMLElement>('[data-slot="scroll-area-viewport"]');
    const section = selectedKey ? content?.querySelector<HTMLElement>(`[data-day="${selectedKey}"]`) : null;
    const picked = shownKey.current !== undefined && shownKey.current !== selectedKey;
    shownKey.current = selectedKey;
    if (!section) return;
    if (viewport && viewport.scrollHeight > viewport.clientHeight) {
      viewport.scrollTo({ top: section.getBoundingClientRect().top - viewport.getBoundingClientRect().top + viewport.scrollTop, behavior: "smooth" });
    } else if (picked) {
      // On a phone the page scrolls rather than the list, so the day is brought up the page. Only when a date is
      // tapped, not when the page opens.
      section.scrollIntoView({ block: "start", behavior: "smooth" });
    }
  }, [selectedKey, loading]);

  return (
    // The scrollbar starts below the first day's header and its line (57px), and stays above the headers that
    // stick to the top as their days scroll, rather than running behind them.
    <ScrollArea className="md:h-full" scrollbarClassName="z-10 !top-[57px] !h-auto">
      <div ref={rowsRef} className="px-3">
        {loading && (
          <div className="flex flex-col gap-2 py-3" aria-label="Loading events">
            {Array.from({ length: 6 }, (_, i) => (
              <div key={i} className="flex items-center gap-3 p-3">
                <Skeleton className="size-8 shrink-0 rounded-full" />
                <div className="flex flex-1 flex-col gap-1">
                  <Skeleton className="h-5 w-2/3" />
                  <Skeleton className="h-4 w-5/6" />
                </div>
              </div>
            ))}
          </div>
        )}
        {!loading && (empty ?? keys.map((key) => {
          const rows = dayRows(byDay.get(key) ?? [], dayTasks.get(key) ?? []);
          return (
            <DaySection key={key} day={key} title={dayTitle(key, today)} count={rows.length}>
              {rows.length === 0 ? (
                <p className="px-3 text-sm text-muted-foreground">No events.</p>
              ) : (
                <div className="flex flex-col gap-2">
                  {rows.map((row, i) => (
                    <Fragment key={row.id}>
                      {i > 0 && <div className="pl-14"><Separator /></div>}
                      {row.event ? <EventRow event={row.event} day={key} /> : <TaskRow item={row.task!} />}
                    </Fragment>
                  ))}
                </div>
              )}
            </DaySection>
          );
        }))}
        {!loading && loadingMore && (
          <div className="flex flex-col gap-2 py-3" aria-label="Loading the next month">
            <Skeleton className="h-5 w-1/3" />
            <Skeleton className="h-4 w-2/3" />
          </div>
        )}
        <div ref={endRef} aria-hidden className="h-px" />
      </div>
    </ScrollArea>
  );
}

/** Keys that would be typed into something are left alone. */
function isTyping(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || !!target.closest('input, textarea, select, [role="tablist"], [role="listbox"], [role="menu"], [role="slider"], [role="dialog"], [role="alertdialog"]');
}

function CalendarPageContent() {
  const { session } = useAuth();
  const userId = session?.user.id;
  const { accounts, tasks } = useApp();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const query = searchParams.toString();
  const eventParam = searchParams.get("event");
  const wide = useWide();
  // The view and date come from the address, so a reload or a shared link opens the same place.
  const [view, setView] = useState<View>(() => {
    const asked = searchParams.get("view");
    return asked === "week" || asked === "day" ? asked : "agenda";
  });
  const [now, setNow] = useState(() => new Date());
  const [search, setSearch] = useState("");
  const term = search.trim().toLowerCase();
  const today = useMemo(() => startOfDay(now), [now.getFullYear(), now.getMonth(), now.getDate()]); // eslint-disable-line react-hooks/exhaustive-deps
  // The selected day: the week view shows its week, the agenda its month.
  const [anchor, setAnchor] = useState(() => parseKey(searchParams.get("date")) ?? startOfDay(new Date()));
  const anchorKey = dayKey(anchor);
  // Scrolling the agenda list moves the month shown above and in the grid to the day at its top, without reloading it.
  const [visibleKey, setVisibleKey] = useState<string | null>(null);
  useEffect(() => setVisibleKey(null), [anchorKey, view]);

  // How many days the week view shows: seven when they fit, else as many as do, starting on the selected day.
  const paneRef = useRef<HTMLDivElement>(null);
  const [paneWidth, setPaneWidth] = useState(0);
  useLayoutEffect(() => {
    const el = paneRef.current;
    if (!el) return;
    setPaneWidth(el.clientWidth);
    const observer = new ResizeObserver(() => setPaneWidth(el.clientWidth));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  const fits = paneWidth === 0 ? 7 : Math.floor((paneWidth - LABELS) / DAY_MIN);
  const weekDays = fits >= 7 ? 7 : Math.max(1, Math.min(5, Math.floor((paneWidth - LABELS) / 100)));

  // The agenda's list carries on into the months after the selected one as it is scrolled to the end. Picking
  // another month starts it over.
  const monthKey = `${anchor.getFullYear()}-${anchor.getMonth()}`;
  const [more, setMore] = useState({ month: monthKey, months: 0 });
  const extraMonths = more.month === monthKey ? more.months : 0;
  const listEnd = new Date(anchor.getFullYear(), anchor.getMonth() + 1 + extraMonths, 1);
  const start = view === "day" ? anchor : view === "week" ? (weekDays === 7 ? startOfWeek(anchor) : anchor) : startOfWeek(startOfMonth(anchor));
  // The month grid needs six weeks; the list may need more.
  const length = view === "day" ? 1 : view === "week" ? weekDays : Math.max(42, Math.round((listEnd.getTime() - start.getTime()) / 86_400_000));
  const startKey = dayKey(start);
  const rangeKey = `${startKey}+${length}`;
  // undefined while loading, null if it failed.
  const [loaded, setLoaded] = useState<{ key: string; events: CalendarEvent[] | null } | undefined>(undefined);
  // Goes up when the days shown should load again.
  const [version, setVersion] = useState(0);
  // Events saved in the dialog that the worker has not created yet, shown as if they were. One leaves this list when
  // the days reload after it was created, or when it failed.
  const [queued, setQueued] = useState<CalendarEvent[]>([]);
  const created = useRef(new Set<string>());
  // Events being deleted, hidden at once (a whole series when that is what was asked for). Each goes when the days
  // reload after the worker has deleted it, or straight away when it could not.
  const [hidden, setHidden] = useState<{ token: string; id: string; seriesId: string | null; scope: DeleteScope }[]>([]);
  const deleted = useRef(new Set<string>());
  const [deleteFor, setDeleteFor] = useState<{ event: CalendarEvent; error?: string } | null>(null);
  // Changes and answers saved but not yet made in the calendar, laid over the events as if they were. One goes when the
  // days reload after the worker made it, or straight away when it could not.
  const [edits, setEdits] = useState<{ token: string; id: string; seriesId: string | null; scope: UpdateScope; patch: EventPatch }[]>([]);
  const updated = useRef(new Set<string>());
  // The event being edited stays set while the editor is closed, so a failed change can open it again as it was.
  const [editFor, setEditFor] = useState<CalendarEvent | null>(null);
  const [editOpen, setEditOpen] = useState(false);
  const [newOpen, setNewOpen] = useState(false);
  const [newDay, setNewDay] = useState<string | undefined>(undefined);
  const [newTime, setNewTime] = useState<string | undefined>(undefined);
  const [newUntil, setNewUntil] = useState<string | undefined>(undefined);
  const [openKey, setOpenKey] = useState<string | null>(null);
  // ?task=<id> opens that task, such as from the Summary. The address then drops it with the rest it does not follow.
  const [openTaskId, setOpenTaskId] = useState<string | null>(() => searchParams.get("task"));
  const [newTaskOpen, setNewTaskOpen] = useState(false);
  // The task being changed in the New Task dialog, or null when it makes a new one.
  const [editTarget, setEditTarget] = useState<Task | null>(null);
  const [details, setDetails] = useState<Map<string, CalendarEvent>>(() => new Map());
  const [detailsFailed, setDetailsFailed] = useState<Set<string>>(() => new Set());
  const requested = useRef(new Set<string>());
  const loadedVersion = useRef(0);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  // Several things can ask for the days to load again at once (Realtime, the dialog and a delete): they load once.
  const reloadTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const reload = useCallback(() => {
    clearTimeout(reloadTimer.current);
    reloadTimer.current = setTimeout(() => setVersion((v) => v + 1), 300);
  }, []);
  useEffect(() => () => clearTimeout(reloadTimer.current), []);

  // The time line and today move on while the page is left open.
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(timer);
  }, []);

  // The address follows the view and date. An event link (?event=) is opened first and then dropped from it.
  useEffect(() => {
    if (eventParam) return;
    const next = new URLSearchParams({ view, date: anchorKey }).toString();
    if (query !== next) router.replace(`${pathname}?${next}`, { scroll: false });
  }, [view, anchorKey, eventParam, query, pathname, router]);

  // ?event=<id> opens that event on its day, such as from the Summary.
  const handledEvent = useRef<string | null>(null);
  useEffect(() => {
    if (!eventParam || !userId || handledEvent.current === eventParam) return;
    handledEvent.current = eventParam;
    loadEventDetail(eventParam)
      .then((event) => {
        if (!mounted.current) return;
        if (!event) {
          toast.error("That event could not be found.");
          router.replace(pathname, { scroll: false });
          return;
        }
        const day = event.allDay ? event.startsAt.slice(0, 10) : dayKey(new Date(event.startsAt));
        requested.current.add(event.id);
        setDetails((map) => new Map(map).set(event.id, event));
        setAnchor(fromKey(day));
        setOpenKey(`${event.id}|${day}`);
        router.replace(`${pathname}?${new URLSearchParams({ view, date: day }).toString()}`, { scroll: false });
      })
      .catch((err) => {
        console.error(err instanceof Error ? err.message : "Load event failed");
        if (!mounted.current) return;
        toast.error("That event did not load.");
        router.replace(pathname, { scroll: false });
      });
  }, [eventParam, userId, pathname, router, view]);

  useEffect(() => {
    // The week view waits to know how many days fit.
    if (!userId || (view === "week" && paneWidth === 0)) return;
    let cancelled = false;
    const from = fromKey(startKey);
    loadEvents(from, addDays(from, length), { details: false })
      .then((events) => {
        if (cancelled) return;
        setLoaded({ key: rangeKey, events });
        if (created.current.size) setQueued((list) => list.filter((e) => !created.current.has(e.id)));
        if (deleted.current.size) setHidden((list) => list.filter((h) => !deleted.current.has(h.token)));
        if (updated.current.size) setEdits((list) => list.filter((e) => !updated.current.has(e.token)));
        // Opened events are fetched again after a reload, as they may have changed.
        if (loadedVersion.current !== version) {
          loadedVersion.current = version;
          requested.current.clear();
          setDetails(new Map());
        }
      })
      .catch((err) => {
        console.error(err instanceof Error ? err.message : "Load events failed");
        if (!cancelled) setLoaded({ key: rangeKey, events: null });
      });
    return () => {
      cancelled = true;
    };
  }, [rangeKey, startKey, length, userId, version, view, paneWidth]);

  // The worker stores a new event in calendar_events before it marks the queued row created.
  useEffect(() => {
    if (!userId) return;
    const channel = supabase
      .channel(`calendar-page-${userId}`)
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "calendar_outbox", filter: `user_id=eq.${userId}` }, (payload) => {
        const row = payload.new as { id?: string; status?: string };
        if (row.status !== "created") return;
        if (row.id) created.current.add(row.id);
        reload();
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [userId, reload]);

  // Guests, notes and the link are fetched for an event once it is opened.
  const openId = openKey ? openKey.split("|")[0] : null;
  // The days before stay on screen while the next ones load, so moving through time never flashes a skeleton.
  const loadedEvents = loaded?.key === rangeKey ? loaded.events : (loaded?.events ?? undefined);
  const loadingMore = view === "agenda" && loaded?.key !== rangeKey && !!loadedEvents;
  useEffect(() => {
    if (!openId || requested.current.has(openId)) return;
    const base = loadedEvents?.find((e) => e.id === openId) ?? queued.find((e) => e.id === openId);
    if (queued.some((e) => e.id === openId)) return;
    if (base?.detailed) return;
    requested.current.add(openId);
    loadEventDetail(openId)
      .then((event) => {
        if (!mounted.current) return;
        if (event) setDetails((map) => new Map(map).set(openId, event));
        else setDetailsFailed((set) => new Set(set).add(openId));
      })
      .catch((err) => {
        console.error(err instanceof Error ? err.message : "Load event failed");
        if (mounted.current) setDetailsFailed((set) => new Set(set).add(openId));
      });
  }, [openId, loadedEvents, queued]);

  const days = useMemo(() => Array.from({ length }, (_, i) => dayKey(addDays(fromKey(startKey), i))), [startKey, length]);
  // An event with the changes saved for it laid over it. A change to a whole series shows on the rest of the series
  // too, except its time, which moves each occurrence by its own amount once the days reload.
  const applyEdits = (event: CalendarEvent) => {
    let patch: EventPatch | undefined;
    for (const edit of edits) {
      if (edit.id === event.id) patch = { ...patch, ...edit.patch };
      else if (edit.scope === "series" && edit.seriesId && edit.seriesId === event.seriesId) {
        const { startsAt: _s, endsAt: _e, allDay: _a, ...rest } = edit.patch;
        patch = { ...patch, ...rest };
      }
    }
    return withPatch(event, patch);
  };
  // The loaded days with the events still being created, unless they have already loaded.
  const events = useMemo(() => {
    if (!loadedEvents) return loadedEvents;
    const waiting = queued.filter((q) => !loadedEvents.some((e) => e.title === q.title && Date.parse(e.startsAt) === Date.parse(q.startsAt))).map((q) => ({ ...q, pending: true, detailed: true }));
    const all = waiting.length ? [...loadedEvents, ...waiting] : loadedEvents;
    const found = term ? all.filter((e) => [e.title, e.location, e.description].some((s) => s?.toLowerCase().includes(term))) : all;
    const shown = hidden.length ? found.filter((e) => !hidden.some((h) => h.id === e.id || (h.scope === "series" && h.seriesId && h.seriesId === e.seriesId))) : all;
    return edits.length ? shown.map(applyEdits) : shown;
  }, [loadedEvents, queued, hidden, edits, term]);
  const byDay = useMemo(() => {
    const map = new Map<string, CalendarEvent[]>();
    for (const e of events ?? []) {
      for (const key of daysOf(e, days)) {
        const list = map.get(key);
        if (list) list.push(e);
        else map.set(key, [e]);
      }
    }
    for (const list of map.values()) list.sort(byTime);
    return map;
  }, [events, days]);
  // Tasks on the days shown, with open overdue ones on today. Shown once events have loaded, so the grid draws once.
  const tasksOnDays = useMemo(() => (events ? tasksByDay(tasks, days, now) : new Map<string, DayTask[]>()), [events, tasks, days, now]);
  const openTask = openTaskId ? (tasks.find((t) => t.id === openTaskId) ?? null) : null;

  const shownDetails = useMemo(() => {
    if (!edits.length) return details;
    return new Map([...details].map(([id, event]) => [id, applyEdits(event)]));
  }, [details, edits]);
  const openEvent = openId ? (shownDetails.get(openId) ?? events?.find((e) => e.id === openId) ?? null) : null;
  const calendarConnected = accounts.some((a) => a.provider === "google_calendar" || a.provider === "outlook_calendar" || a.provider === "icloud_calendar");
  const todayKey = dayKey(today);
  const timeGrid = view === "week" || view === "day";

  // A month away lands on its first day, or on today in today's month.
  const moveMonth = (n: number) => {
    const first = new Date(anchor.getFullYear(), anchor.getMonth() + n, 1);
    setAnchor(first.getMonth() === today.getMonth() && first.getFullYear() === today.getFullYear() ? today : first);
  };
  const move = (n: number) => (timeGrid ? setAnchor(addDays(anchor, length * n)) : moveMonth(n));
  const label =
    view === "day" ? anchor.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", ...(anchor.getFullYear() !== today.getFullYear() ? { year: "numeric" } : {}) })
    : view === "week" ? rangeLabel(start, addDays(start, length), today)
    : (visibleKey ? fromKey(visibleKey) : anchor).toLocaleDateString("en-GB", { month: "long", year: "numeric" });
  // The month grid follows the day at the top of the agenda list as it scrolls, inside the days already loaded.
  const gridAnchor = view === "agenda" && visibleKey ? fromKey(visibleKey) : anchor;
  const gridDays = useMemo(() => {
    if (view !== "agenda") return days;
    const first = dayKey(startOfWeek(startOfMonth(gridAnchor)));
    const at = days.indexOf(first);
    return at >= 0 && at + 42 <= days.length ? days.slice(at, at + 42) : days.slice(0, 42);
  }, [view, days, gridAnchor]);
  const unit = view === "day" ? "Day" : view === "week" ? (length === 7 ? "Week" : "Days") : "Month";

  const openNew = (day: string, time?: string, until?: string) => {
    setNewDay(day);
    setNewTime(time);
    setNewUntil(until);
    setNewOpen(true);
  };

  // Scrolling moves through time: down past the end of a day for the next one, sideways across a week for the next.
  // Scrolling inside a view that still has room to scroll is left alone.
  const moveRef = useRef(move);
  moveRef.current = move;
  useEffect(() => {
    const el = paneRef.current;
    if (!el) return;
    if (view === "agenda") {
      // Scrolling the month grid scrolls the agenda list, and the grid follows it.
      const forward = (e: WheelEvent) => {
        const list = document.querySelector<HTMLElement>('[data-calendar-list] [data-slot="scroll-area-viewport"]');
        if (list && list.scrollHeight > list.clientHeight) list.scrollTop += e.deltaY;
      };
      el.addEventListener("wheel", forward, { passive: true });
      return () => el.removeEventListener("wheel", forward);
    }
    let travelled = 0;
    let lastAt = 0;
    let cooldown = 0;
    const onWheel = (e: WheelEvent) => {
      const stamp = performance.now();
      if (stamp < cooldown) return;
      if (stamp - lastAt > 300) travelled = 0;
      lastAt = stamp;
      let delta = 0;
      if (view === "week") {
        // Mostly sideways: a trackpad swipe, or the wheel with Shift held.
        delta = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.shiftKey ? e.deltaY : 0;
      } else {
        let node = e.target as HTMLElement | null;
        let room = false;
        while (node && node !== el) {
          if (node.scrollHeight > node.clientHeight && /auto|scroll/.test(getComputedStyle(node).overflowY)) {
            const atEdge = e.deltaY > 0 ? node.scrollTop + node.clientHeight >= node.scrollHeight - 1 : node.scrollTop <= 0;
            if (!atEdge) room = true;
            break;
          }
          node = node.parentElement;
        }
        delta = room || Math.abs(e.deltaX) > Math.abs(e.deltaY) ? 0 : e.deltaY;
      }
      if (!delta) { travelled = 0; return; }
      travelled += delta;
      if (Math.abs(travelled) < 160) return;
      moveRef.current(travelled > 0 ? 1 : -1);
      travelled = 0;
      cooldown = stamp + 700;
    };
    el.addEventListener("wheel", onWheel, { passive: true });
    return () => el.removeEventListener("wheel", onWheel);
  }, [view]);

  // T is today, the arrows move a day, A, D and W switch the view.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || e.defaultPrevented || isTyping(e.target) || newOpen || editOpen || deleteFor || openKey || openTask || newTaskOpen) return;
      const key = e.key.toLowerCase();
      if (key === "t") setAnchor(today);
      else if (key === "a") setView("agenda");
      else if (key === "d") setView("day");
      else if (key === "w") setView("week");
      else if (e.key === "ArrowLeft") setAnchor((d) => addDays(d, -1));
      else if (e.key === "ArrowRight") setAnchor((d) => addDays(d, 1));
      else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [today, newOpen, editOpen, deleteFor, openKey, openTask, newTaskOpen]);

  // With no account connected at all, the first step is connecting one.
  const noAccounts = !accounts.some((a) => a.status !== "disconnected");
  const notConnected = !calendarConnected && events && events.length === 0 && tasks.length === 0 && (
    <div className="py-12">
      {noAccounts ? (
        <EmptyState
          icon={CalendarDays}
          title="Connect an Account"
          description="Connect Google, Outlook or iCloud Calendar to see your events here."
          action={<Button asChild><Link href="/settings/accounts">Connect an Account</Link></Button>}
        />
      ) : (
        <EmptyState
          icon={CalendarDays}
          title="Nothing Scheduled"
          description="Connect Google, Outlook or iCloud Calendar in Settings to see your events here."
          action={<Button variant="outline" asChild><Link href="/settings/accounts">Connected Accounts</Link></Button>}
        />
      )}
    </div>
  );
  // The days listed: the month view's list follows the date picked, the week view's lists the week's events.
  const listed = timeGrid
    ? days.filter((key) => byDay.has(key) || tasksOnDays.has(key))
    : days.filter((key) => {
        const day = fromKey(key);
        return day >= startOfMonth(anchor) && day < listEnd && (byDay.has(key) || tasksOnDays.has(key) || key === anchorKey);
      });
  const noEvents = events && listed.length === 0 && (
    <div className="py-12">
      <EmptyState icon={CalendarDays} title="No Events" description={view === "day" ? "Nothing is scheduled this day." : view === "week" ? "Nothing is scheduled in these days." : "Nothing is scheduled this month."} />
    </div>
  );

  const deletedFrom = accounts.find((a) => a.id === deleteFor?.event.accountId)?.provider === "icloud_calendar" ? "iCloud Calendar" : "Google Calendar";
  // Answers an invitation. The answer shows at once, marked as saving, while the worker sends it to the calendar.
  const answer = useCallback(
    async (event: CalendarEvent, response: EventResponse) => {
      if (!event.accountId) return;
      const pending = { token: `answer-${event.id}-${Date.now()}`, id: event.id, seriesId: null, scope: "occurrence" as const, patch: { response } };
      setEdits((list) => [...list, pending]);
      const dropPending = (token: string) => setEdits((list) => list.filter((e) => e.token !== token));
      const { data, error } = await supabase.from("calendar_updates").insert(buildResponse(event, response)).select("id").single();
      if (error || !data) {
        dropPending(pending.token);
        toast.error("Could not save your answer. Try again.");
        return;
      }
      const token = data.id;
      setEdits((list) => list.map((e) => (e.token === pending.token ? { ...e, token } : e)));
      const result = await followUpdate(token);
      if (result.status === "done") {
        updated.current.add(token);
        reload();
        return;
      }
      dropPending(token);
      toast.error(result.error ?? "Your answer could not be sent.");
    },
    [reload],
  );
  const context = useMemo<PageContext>(
    () => ({
      wide,
      now,
      openKey,
      setOpenKey,
      details: shownDetails,
      detailsFailed,
      askToDelete: (event) => setDeleteFor({ event }),
      askToEdit: (event) => {
        setEditFor(event);
        setEditOpen(true);
      },
      answer: (event, response) => void answer(event, response),
      openTask: setOpenTaskId,
      sourceOf: (task) => {
        const provider = accounts.find((a) => a.id === task.accountId)?.provider;
        return provider ? providerLabel[provider] : undefined;
      },
    }),
    [wide, now, openKey, shownDetails, detailsFailed, answer, accounts],
  );

  // The same split as Conversations and Summary: the header and the list on the left, what they are about
  // beside it. Phones stack them, the grid between the header and the list.
  return (
    <Page.Provider value={context}>
      <div className="flex h-full min-h-0 flex-col overflow-y-auto md:grid md:grid-cols-[20rem_minmax(0,1fr)] md:grid-rows-[auto_minmax(0,1fr)] md:overflow-hidden lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
        {/* The same two bands as Conversations: title and views, then search. */}
        <div className="shrink-0 bg-background md:col-start-1 md:row-start-1 md:border-r">
          <PaneHeader
            title="Calendar"
            action={
              <div className="flex shrink-0 items-center gap-2">
                <Button variant="secondary" onClick={() => setNewTaskOpen(true)}>New Task</Button>
                <Button variant="secondary" onClick={() => openNew(anchorKey)}>New Event</Button>
              </div>
            }
          >
            <PaneControls>
              <ViewButtons label="View" value={view} onSelect={setView} items={[{ key: "agenda", label: "Agenda" }, { key: "day", label: "Day" }, { key: "week", label: "Week" }]} />
            </PaneControls>
          </PaneHeader>
          <SearchBand value={search} onChange={setSearch} placeholder="Search Events" />
        </div>

        {/* The month or dates on show, with the arrows on the far right, like the header of every other page. */}
        <div className="min-w-0 shrink-0 md:col-start-2 md:row-span-2 md:row-start-1 md:flex md:min-h-0 md:flex-col">
          <header className="flex shrink-0 items-center justify-between gap-2 border-b bg-background p-3 md:px-4">
            <span className="flex h-8 min-w-0 items-center truncate text-sm text-muted-foreground tabular-nums">{label}</span>
            <div className="flex shrink-0 items-center gap-1">
              <Button variant="ghost" size="icon" aria-label={`Previous ${unit}`} onClick={() => move(-1)}><ArrowLeft /></Button>
              <Button variant="ghost" size="icon" aria-label={`Next ${unit}`} onClick={() => move(1)}><ArrowRight /></Button>
            </div>
          </header>
          {/* On phones the page scrolls as one column, so the grid and the list keep their full height (shrink-0):
              allowed to shrink, the column squeezed them and the grid's weeks drew over the list. */}
          <div ref={paneRef} className="min-w-0 shrink-0 md:min-h-0 md:flex-1">
            {events === undefined && (
              <div className="flex flex-col gap-3 p-3" aria-label="Loading events">
                <Skeleton className="h-8 w-full" />
                <Skeleton className="h-96 w-full rounded-lg" />
              </div>
            )}
            {events === null && (
              <div className="py-24">
                <EmptyState
                  icon={CalendarDays}
                  title="Events Did Not Load"
                  description="Check your connection, then try again."
                  action={<Button variant="secondary" onClick={() => { setLoaded(undefined); setVersion((v) => v + 1); }}>Try Again</Button>}
                />
              </div>
            )}
            {events && view === "agenda" && <MonthView days={gridDays} byDay={byDay} tasksByDay={tasksOnDays} today={today} selected={gridAnchor} monthOf={gridAnchor} onSelect={setAnchor} onCreate={(key) => openNew(key)} />}
            {events && timeGrid && (
              <WeekView
                days={days}
                byDay={byDay}
                tasksByDay={tasksOnDays}
                today={today}
                now={now}
                selectedKey={anchorKey}
                inline={!wide}
                onSelectDay={(key) => setAnchor(fromKey(key))}
                onCreateAt={openNew}
              />
            )}
          </div>
        </div>

        <div data-calendar-list className="shrink-0 border-t md:col-start-1 md:row-start-2 md:min-h-0 md:border-t-0 md:border-r">
          {events !== null && (
            <EventList
              keys={listed}
              byDay={byDay}
              tasksByDay={tasksOnDays}
              today={today}
              selectedKey={view === "agenda" ? anchorKey : undefined}
              loading={events === undefined}
              empty={notConnected || noEvents || null}
              // A year ahead at most.
              onEnd={view === "agenda" && !loadingMore && extraMonths < 12 ? () => setMore({ month: monthKey, months: extraMonths + 1 }) : undefined}
              loadingMore={loadingMore}
              onVisible={view === "agenda" ? setVisibleKey : undefined}
            />
          )}
        </div>

        <EventDialog event={openEvent} onClose={() => setOpenKey(null)} />
        <TaskDialog task={openTask} onClose={() => setOpenTaskId(null)} onEdit={(t) => { setOpenTaskId(null); setEditTarget(t); setNewTaskOpen(true); }} />
        <NewTaskDialog open={newTaskOpen} onOpenChange={(o) => { setNewTaskOpen(o); if (!o) setEditTarget(null); }} editing={editTarget ?? undefined} />
        <NewEventDialog
          open={newOpen}
          onOpenChange={setNewOpen}
          day={newDay}
          time={newTime}
          until={newUntil}
          onQueued={(event) => setQueued((list) => [...list, event])}
          onCreated={(id) => { created.current.add(id); reload(); }}
          onFailed={(id) => setQueued((list) => list.filter((e) => e.id !== id))}
        />
        {editFor && (
          <NewEventDialog
            open={editOpen}
            onOpenChange={setEditOpen}
            editing={editFor}
            onEditQueued={(token, event, patch, scope) => setEdits((list) => [...list, { token, id: event.id, seriesId: event.seriesId ?? null, scope, patch }])}
            onEditDone={(token) => { updated.current.add(token); reload(); }}
            onEditFailed={(token) => setEdits((list) => list.filter((e) => e.token !== token))}
          />
        )}
        <DeleteEventDialog
          target={deleteFor}
          calendar={deletedFrom}
          onClose={() => setDeleteFor(null)}
          onStart={(token, event, scope) => setHidden((list) => [...list, { token, id: event.id, seriesId: event.seriesId ?? null, scope }])}
          onDone={(token) => { deleted.current.add(token); reload(); }}
          onFail={(token, event, error) => { setHidden((list) => list.filter((h) => h.token !== token)); setDeleteFor({ event, error }); }}
        />
      </div>
    </Page.Provider>
  );
}

export default function CalendarPage() {
  return (
    <Suspense fallback={null}>
      <CalendarPageContent />
    </Suspense>
  );
}
