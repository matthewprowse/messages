"use client";

// The Calendar page: agenda, week and day views of events and tasks from every connected account.
// View, date and open event live in the address (?view, ?date, ?event), so a reload or shared link opens the same place.


import { Suspense, useEffect, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { CalendarDays } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { useApp } from "@/lib/store";
import { visibleEvents } from "@/lib/event-filter";
import { applyEdits, type CalendarEvent } from "@/lib/calendar";
import { daysOf } from "@/lib/calendar-days";
import { addDays, dayKey, fromKey, parseKey, startOfDay, startOfMonth, startOfWeek } from "@/lib/dates";
import { syncNotice } from "@/lib/sync-window";
import { tasksByDay, undatedTasks, visibleTasks, type DayTask } from "@/lib/tasks";
import type { Task } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { PaneHeader, ViewButtons } from "@/components/pane";
import { EmptyState, providerLabel } from "@/components/primitives";
import { NewEventDialog } from "@/components/new-event-dialog";
import { NewTaskDialog } from "@/components/new-task-dialog";
import { DeleteEventDialog } from "@/components/delete-event-dialog";

import { CalendarActions } from "@/components/calendar/calendar-actions";
import { CalendarEmpty } from "@/components/calendar/calendar-empty";
import { DAY_MIN, LABELS, View, byTime, longDate, rangeLabel } from "@/components/calendar/dates";
import { CopyFreeTimes } from "@/components/calendar/copy-free-times";
import { EventDialog } from "@/components/calendar/event-details";
import { EventList } from "@/components/calendar/event-list";
import { GridBar, GridNotes } from "@/components/calendar/grid-bar";
import { MonthView } from "@/components/calendar/month-view";
import { Now, Page, PageContext, useWide } from "@/components/calendar/page-context";
import { TaskDialog } from "@/components/calendar/task-parts";
import { UndatedTasks } from "@/components/calendar/undated-tasks";
import { useCalendarData } from "@/components/calendar/use-calendar-data";
import { useCalendarKeys } from "@/components/calendar/use-calendar-input";
import { usePaneWidth } from "@/components/calendar/use-pane-width";
import { usePendingChanges } from "@/components/calendar/use-pending-changes";
import { useReload } from "@/components/calendar/use-reload";
import { WeekStrip } from "@/components/calendar/week-strip";
import { WeekView } from "@/components/calendar/week-view";
import { cn } from "@/lib/utils";

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
  const [view, setGridView] = useState<View>(() => {
    const asked = searchParams.get("view");
    return asked === "week" || asked === "day" ? asked : "agenda";
  });
  // No Date swaps the list for the tasks with no day; the grid keeps the view it had.
  const [undated, setUndated] = useState(false);
  const setView = (next: View) => { setUndated(false); setGridView(next); };
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
  const { ref: paneRef, width: paneWidth } = usePaneWidth();
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
  const { version, setVersion, mounted, reload, later } = useReload();
  const pending = usePendingChanges(reload);
  const { queued, setQueued, hidden, setHidden, edits, setEdits, created, deleted, updated } = pending;
  const [deleteFor, setDeleteFor] = useState<{ event: CalendarEvent; error?: string } | null>(null);
  // The event being edited stays set while the editor is closed, so a failed change can open it again as it was.
  const [editFor, setEditFor] = useState<CalendarEvent | null>(null);
  const [editOpen, setEditOpen] = useState(false);
  const [newOpen, setNewOpen] = useState(false);
  const [freeOpen, setFreeOpen] = useState(false);
  const [newDay, setNewDay] = useState<string | undefined>(undefined);
  const [newTime, setNewTime] = useState<string | undefined>(undefined);
  const [newUntil, setNewUntil] = useState<string | undefined>(undefined);
  // ?task=<id> opens that task, such as from the Summary. The address then drops it with the rest it does not follow.
  const [openTaskId, setOpenTaskId] = useState<string | null>(() => searchParams.get("task"));
  const [newTaskOpen, setNewTaskOpen] = useState(false);
  // The task being changed in the New Task dialog, or null when it makes a new one.
  const [editTarget, setEditTarget] = useState<Task | null>(null);
  const { loaded, setLoaded, refreshFailed, loadedEvents, openKey, setOpenKey, openId, details, detailsFailed } = useCalendarData({ userId, view, setAnchor, sized: view !== "week" || paneWidth > 0, startKey, length, rangeKey, version, mounted, reload, pending });
  // Other days are loading while the ones already shown stay on screen.
  const loadingOther = loaded?.key !== rangeKey && !!loadedEvents;
  const loadingMore = view === "agenda" && loadingOther;

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

  const days = useMemo(() => Array.from({ length }, (_, i) => dayKey(addDays(fromKey(startKey), i))), [startKey, length]);
  // The loaded days with the events still being created, unless they have already loaded.
  const events = useMemo(() => {
    if (!loadedEvents) return loadedEvents;
    const waiting = queued.filter((q) => !loadedEvents.some((e) => e.title === q.title && Date.parse(e.startsAt) === Date.parse(q.startsAt))).map((q) => ({ ...q, pending: true, detailed: true }));
    const all = waiting.length ? [...loadedEvents, ...waiting] : loadedEvents;
    const shown = visibleEvents(all, term, hidden);
    return edits.length ? shown.map((e) => applyEdits(edits, e)) : shown;
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
  const tasksOnDays = useMemo(() => (events ? tasksByDay(visibleTasks(tasks, term), days, now) : new Map<string, DayTask[]>()), [events, tasks, term, days, now]);
  const undatedList = useMemo(() => undatedTasks(tasks, term), [tasks, term]);
  const openTask = openTaskId ? (tasks.find((t) => t.id === openTaskId) ?? null) : null;

  const shownDetails = useMemo(() => {
    if (!edits.length) return details;
    return new Map([...details].map(([id, event]) => [id, applyEdits(edits, event)]));
  }, [details, edits]);
  const openEvent = openId ? (shownDetails.get(openId) ?? events?.find((e) => e.id === openId) ?? null) : null;
  const calendarConnected = accounts.some((a) => a.provider === "google_calendar" || a.provider === "outlook_calendar" || a.provider === "icloud_calendar");
  const timeGrid = view === "week" || view === "day";
  // Days beyond what the worker has read say so, rather than looking like a free diary. Held back while the days load.
  const notice = events && !loadingOther ? syncNotice(startKey, days[days.length - 1] ?? startKey, today, (loadedEvents?.length ?? 0) > 0) : null;

  // A month away lands on its first day, or on today in today's month.
  const moveMonth = (n: number) => {
    const first = new Date(anchor.getFullYear(), anchor.getMonth() + n, 1);
    setAnchor(first.getMonth() === today.getMonth() && first.getFullYear() === today.getFullYear() ? today : first);
  };
  // The month grid follows the day at the top of the agenda list as it scrolls, inside the days already loaded.
  const gridAnchor = view === "agenda" && visibleKey ? fromKey(visibleKey) : anchor;
  // A phone's agenda shows a week strip in place of the month grid, so its arrows move a week.
  const byWeek = view === "agenda" && !wide;
  const move = (n: number) => (timeGrid ? setAnchor(addDays(anchor, length * n)) : byWeek ? setAnchor(addDays(startOfWeek(gridAnchor), 7 * n)) : moveMonth(n));
  const label =
    view === "day" ? longDate(anchor, today)
    : view === "week" ? rangeLabel(start, addDays(start, length), today)
    : (visibleKey ? fromKey(visibleKey) : anchor).toLocaleDateString("en-GB", { month: "long", year: "numeric" });
  const gridDays = useMemo(() => {
    if (view !== "agenda") return days;
    const first = dayKey(startOfWeek(startOfMonth(gridAnchor)));
    const at = days.indexOf(first);
    return at >= 0 && at + 42 <= days.length ? days.slice(at, at + 42) : days.slice(0, 42);
  }, [view, days, gridAnchor]);
  const unit = view === "day" ? "Day" : view === "week" ? (length === 7 ? "Week" : "Days") : byWeek ? "Week" : "Month";
  const stripStart = startOfWeek(gridAnchor);
  const stripDays = Array.from({ length: 7 }, (_, i) => dayKey(addDays(stripStart, i)));

  const openNew = (day: string, time?: string, until?: string) => {
    setNewDay(day);
    setNewTime(time);
    setNewUntil(until);
    setNewOpen(true);
  };

  useCalendarKeys({ today, blocked: newOpen || freeOpen || editOpen || !!deleteFor || !!openKey || !!openTask || newTaskOpen, setAnchor, setView, onNewEvent: () => openNew(anchorKey), onNewTask: () => setNewTaskOpen(true) });

  // The days listed: the month view's list follows the date picked, the week view's lists the week's events.
  const listed = timeGrid
    ? days.filter((key) => byDay.has(key) || tasksOnDays.has(key))
    : days.filter((key) => {
        const day = fromKey(key);
        return day >= startOfMonth(anchor) && day < listEnd && (byDay.has(key) || tasksOnDays.has(key) || key === anchorKey);
      });
  // With no account connected at all, the first step is connecting one; with no calendar, connecting a calendar.
  const noAccounts = !accounts.some((a) => a.status !== "disconnected");
  const notConnected = !calendarConnected && events?.length === 0 && tasks.length === 0;
  const empty = events && (notConnected || listed.length === 0) ? (
    <CalendarEmpty kind={notConnected ? (noAccounts ? "no_accounts" : "no_calendar") : "no_events"} onNewEvent={calendarConnected ? () => openNew(anchorKey) : undefined} />
  ) : null;

  const deleteProvider = accounts.find((a) => a.id === deleteFor?.event.accountId)?.provider;
  const deletedFrom = deleteProvider ? providerLabel[deleteProvider] : "your calendar";
  const context = useMemo<PageContext>(
    () => ({
      wide,
      openKey,
      setOpenKey,
      details: shownDetails,
      detailsFailed,
      askToDelete: (event) => setDeleteFor({ event }),
      askToEdit: (event) => {
        setEditFor(event);
        setEditOpen(true);
      },
      answer: (event, response, scope) => void pending.answer(event, response, scope),
      openTask: setOpenTaskId,
      sourceOf: (task) => {
        const provider = accounts.find((a) => a.id === task.accountId)?.provider;
        return provider ? providerLabel[provider] : undefined;
      },
      providerOf: (accountId) => (accountId ? accounts.find((a) => a.id === accountId)?.provider : undefined),
    }),
    [wide, openKey, shownDetails, detailsFailed, pending.answer, accounts],
  );

  // The same split as Conversations and Summary: the header and the list on the left, the grid in a white card on the
  // grey beside it. Phones stack them, the grid between the header and the list. On a phone the agenda (and No Date)
  // keeps the header and the week strip in place and scrolls only the list; the day and week views are taller than the
  // screen, so there the column scrolls as one.
  const pinned = view === "agenda" || undated;
  return (
    <Now.Provider value={now}>
    <Page.Provider value={context}>
      <div className={cn("flex h-full min-h-0 flex-col md:grid md:grid-cols-[20rem_minmax(0,1fr)] md:grid-rows-[auto_minmax(0,1fr)] md:overflow-hidden lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]", pinned ? "overflow-hidden" : "overflow-y-auto")}>
        <div className="shrink-0 md:col-start-1 md:row-start-1">
          <PaneHeader
            title="Calendar"
            action={<CalendarActions onNewEvent={() => openNew(anchorKey)} onNewTask={() => setNewTaskOpen(true)} onFreeTimes={() => setFreeOpen(true)} />}
            views={
              <ViewButtons
                label="View"
                value={undated ? "undated" : view}
                onSelect={(key) => (key === "undated" ? setUndated(true) : setView(key))}
                items={[{ key: "agenda", label: "Agenda" }, { key: "day", label: "Day" }, { key: "week", label: "Week" }, { key: "undated", label: "No Date", count: undatedList.length }]}
              />
            }
            search={{ value: search, onChange: setSearch, placeholder: "Search Calendar" }}
          />
        </div>

        {/* The grid is too wide for a narrow column, so it keeps the wide side, whole in one card. No Date on a phone hides it. */}
        <div className={cn("min-w-0 shrink-0 md:col-start-2 md:row-span-2 md:row-start-1 md:flex md:min-h-0 md:flex-col md:bg-muted/50", undated && "max-md:hidden")}>
          <div className="flex min-w-0 flex-col border-b md:m-3 md:min-h-0 md:flex-1 md:overflow-hidden md:rounded-lg md:border md:bg-background">
            <GridBar label={label} unit={unit} onMove={move} onToday={() => setAnchor(today)} />
            {loadingOther && <div className="h-0.5 w-full shrink-0 animate-pulse bg-primary/50" role="progressbar" aria-label="Loading events" />}
            <GridNotes refreshFailed={refreshFailed} notice={notice} onRetry={() => setVersion((v) => v + 1)} />
            {/* On phones the page scrolls as one column, so the grid and the list keep their full height (shrink-0):
                allowed to shrink, the column squeezed them and the grid's weeks drew over the list. */}
            <div ref={paneRef} className="min-w-0 shrink-0 md:min-h-0 md:flex-1">
              {events === undefined && (
                <div className="flex flex-col p-3 md:h-full" aria-label="Loading events">
                  <Skeleton className="h-16 w-full rounded-lg md:h-full" />
                </div>
              )}
              {events === null && (
                <div className="py-24">
                  <EmptyState icon={CalendarDays} title="Events Did Not Load" action={<Button variant="secondary" onClick={() => { setLoaded(undefined); setVersion((v) => v + 1); }}>Try Again</Button>} />
                </div>
              )}
              {events && view === "agenda" && (wide
                ? <MonthView days={gridDays} byDay={byDay} tasksByDay={tasksOnDays} today={today} selected={gridAnchor} monthOf={gridAnchor} onSelect={setAnchor} onCreate={(key) => openNew(key)} />
                : <WeekStrip days={stripDays} byDay={byDay} tasksByDay={tasksOnDays} today={today} selectedKey={anchorKey} onSelect={(key) => setAnchor(fromKey(key))} />)}
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
        </div>

        <div data-calendar-list className={cn("md:col-start-1 md:row-start-2 md:min-h-0", pinned ? "min-h-0 flex-1" : "shrink-0")}>
          {undated ? (
            <UndatedTasks tasks={undatedList} onNewTask={() => setNewTaskOpen(true)} />
          ) : events !== null && (
            <EventList
              keys={listed}
              byDay={byDay}
              tasksByDay={tasksOnDays}
              today={today}
              selectedKey={view === "agenda" ? anchorKey : undefined}
              loading={events === undefined}
              empty={empty}
              // A year ahead at most.
              onEnd={view === "agenda" && !loadingMore && extraMonths < 12 ? () => setMore({ month: monthKey, months: extraMonths + 1 }) : undefined}
              loadingMore={loadingMore}
              onVisible={view === "agenda" ? setVisibleKey : undefined}
            />
          )}
        </div>

        <CopyFreeTimes open={freeOpen} onOpenChange={setFreeOpen} queued={queued} now={now} />
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
          onLate={(id) => later(() => created.current.add(id))}
        />
        {editFor && (
          <NewEventDialog
            open={editOpen}
            onOpenChange={setEditOpen}
            editing={editFor}
            onEditQueued={(token, event, patch, scope) => setEdits((list) => [...list, { token, id: event.id, seriesId: event.seriesId ?? null, scope, patch }])}
            onEditDone={(token) => { updated.current.add(token); reload(); }}
            onEditFailed={(token) => setEdits((list) => list.filter((e) => e.token !== token))}
            onEditLate={(token) => later(() => updated.current.add(token))}
          />
        )}
        <DeleteEventDialog
          target={deleteFor}
          calendar={deletedFrom}
          onClose={() => setDeleteFor(null)}
          onStart={(token, event, scope) => setHidden((list) => [...list, { token, id: event.id, seriesId: event.seriesId ?? null, scope }])}
          onDone={(token) => { deleted.current.add(token); reload(); }}
          onLate={(token) => later(() => deleted.current.add(token))}
          onFail={(token, event, error) => { setHidden((list) => list.filter((h) => h.token !== token)); setDeleteFor({ event, error }); }}
        />
      </div>
    </Page.Provider>
    </Now.Provider>
  );
}

export default function CalendarPage() {
  return (
    <Suspense
      fallback={
        <div className="flex flex-col gap-3 p-3" aria-label="Loading events">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-96 w-full rounded-lg" />
        </div>
      }
    >
      <CalendarPageContent />
    </Suspense>
  );
}
