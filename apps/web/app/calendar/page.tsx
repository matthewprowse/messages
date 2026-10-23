"use client";

import { Fragment, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { CalendarDays, ChevronLeft, ChevronRight } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { useApp } from "@/lib/store";
import { dayKey, daysOf, loadEvents, type CalendarEvent } from "@/lib/calendar";
import { supabase } from "@/lib/supabase";
import { timeOf } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { EmptyState } from "@/components/primitives";
import { NewEventDialog } from "@/components/new-event-dialog";

type View = "agenda" | "week";

const HOUR = 48; // height of an hour in the week view, in pixels
const MIN_EVENT = 20; // shortest an event is drawn, in minutes, so its title fits

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

function dayTitle(key: string, today: Date) {
  if (key === dayKey(today)) return "Today";
  if (key === dayKey(addDays(today, 1))) return "Tomorrow";
  if (key === dayKey(addDays(today, -1))) return "Yesterday";
  const d = fromKey(key);
  return d.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", ...(d.getFullYear() !== today.getFullYear() ? { year: "numeric" } : {}) });
}

function rangeLabel(start: Date, end: Date) {
  const last = addDays(end, -1);
  const sameMonth = start.getMonth() === last.getMonth() && start.getFullYear() === last.getFullYear();
  const from = start.toLocaleDateString("en-GB", sameMonth ? { day: "numeric" } : { day: "numeric", month: "short" });
  const to = last.toLocaleDateString("en-GB", { day: "numeric", month: "short", ...(last.getFullYear() !== new Date().getFullYear() ? { year: "numeric" } : {}) });
  return `${from} to ${to}`;
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

/** All-day events first, then by start time. */
function byTime(a: CalendarEvent, b: CalendarEvent) {
  return Number(b.allDay) - Number(a.allDay) || a.startsAt.localeCompare(b.startsAt) || a.title.localeCompare(b.title);
}

function Attendees({ event }: { event: CalendarEvent }) {
  if (event.attendees.length === 0) return null;
  return (
    <p className="text-xs text-muted-foreground">
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

function EventDetails({ event }: { event: CalendarEvent }) {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <span className="text-sm font-medium break-words">{event.title}</span>
      <span className="text-xs tabular-nums text-muted-foreground">{timeRange(event)}</span>
      {event.location && <span className="text-xs break-words text-muted-foreground">{event.location}</span>}
      <Attendees event={event} />
    </div>
  );
}

/** An event in the week grid; clicking it shows everything about it. */
function EventChip({ event, className, style, children }: { event: CalendarEvent; className?: string; style?: React.CSSProperties; children: React.ReactNode }) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button type="button" style={style} className={cn("min-w-0 overflow-hidden rounded-md bg-secondary text-left text-xs text-secondary-foreground transition-colors outline-none hover:bg-accent focus-visible:ring-3 focus-visible:ring-ring/50", className)}>
          {children}
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-72">
        <EventDetails event={event} />
      </PopoverContent>
    </Popover>
  );
}

/**
 * Where each timed event sits in a day column: minutes from midnight, and which of how many side by
 * side columns it takes when it overlaps others.
 */
function layoutDay(key: string, events: CalendarEvent[]) {
  const dayStart = fromKey(key).getTime();
  const items = events
    .map((event) => {
      const start = new Date(event.startsAt).getTime();
      const end = event.endsAt ? new Date(event.endsAt).getTime() : start;
      const top = Math.max(0, (start - dayStart) / 60_000);
      const bottom = Math.max(top + MIN_EVENT, Math.min(1440, (end - dayStart) / 60_000));
      return { event, top, bottom: Math.min(1440, bottom), col: 0, cols: 1 };
    })
    .sort((a, b) => a.top - b.top || b.bottom - a.bottom);

  // Events that overlap, directly or through each other, share the width of the column.
  let cluster: typeof items = [];
  let clusterEnd = -1;
  const finish = () => {
    const cols = Math.max(0, ...cluster.map((i) => i.col)) + 1;
    for (const i of cluster) i.cols = cols;
  };
  for (const item of items) {
    if (item.top >= clusterEnd && cluster.length) {
      finish();
      cluster = [];
    }
    const taken = new Set(cluster.filter((i) => i.bottom > item.top).map((i) => i.col));
    let col = 0;
    while (taken.has(col)) col++;
    item.col = col;
    cluster.push(item);
    clusterEnd = Math.max(clusterEnd, item.bottom);
  }
  if (cluster.length) finish();
  return items;
}

function hourLabel(h: number) {
  return `${String(h).padStart(2, "0")}:00`;
}

/** The seven days across with the hours down the side, like Apple Calendar's week. */
function WeekView({ days, byDay, today, now }: { days: string[]; byDay: Map<string, CalendarEvent[]>; today: Date; now: Date }) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const todayKey = dayKey(today);
  const nowMinutes = now.getHours() * 60 + now.getMinutes();
  const allDay = days.map((key) => (byDay.get(key) ?? []).filter((e) => e.allDay));
  const hasAllDay = allDay.some((list) => list.length > 0);

  // Opens an hour before now in today's week, else at 08:00, or earlier when an event this week starts earlier.
  useLayoutEffect(() => {
    const el = scrollRef.current;
    const earliest = Math.min(...days.flatMap((key) => (byDay.get(key) ?? []).filter((e) => !e.allDay && dayKey(new Date(e.startsAt)) === key).map((e) => new Date(e.startsAt).getHours())));
    // A little higher than the hour, so its label is not cut off under the day names.
    if (el) el.scrollTop = Math.max(0, Math.min(earliest, days.includes(todayKey) ? Math.max(0, now.getHours() - 1) : 8) * HOUR - 12);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [days[0]]);

  return (
    <div className="h-full overflow-x-auto">
      <div className="flex h-full min-w-[44rem] flex-col">
        <div className="flex shrink-0 overflow-y-hidden border-b [scrollbar-gutter:stable]">
          <div className="w-14 shrink-0" />
          {days.map((key) => {
            const d = fromKey(key);
            const isToday = key === todayKey;
            return (
              <div key={key} className="flex min-w-0 flex-1 items-center justify-center gap-1.5 py-2 text-sm">
                <span className="text-muted-foreground">{d.toLocaleDateString("en-GB", { weekday: "short" })}</span>
                <span className={cn("flex size-7 items-center justify-center rounded-full tabular-nums", isToday && "bg-primary font-medium text-primary-foreground")}>{d.getDate()}</span>
              </div>
            );
          })}
        </div>
        {hasAllDay && (
          <div className="flex shrink-0 overflow-y-hidden border-b [scrollbar-gutter:stable]">
            <div className="w-14 shrink-0 py-1.5 pr-2 text-right text-xs text-muted-foreground">All Day</div>
            {days.map((key, i) => (
              <div key={key} className="flex min-w-0 flex-1 flex-col gap-1 border-l p-1">
                {allDay[i].map((e) => (
                  <EventChip key={e.id} event={e} className="truncate px-1.5 py-0.5 font-medium">{e.title}</EventChip>
                ))}
              </div>
            ))}
          </div>
        )}
        <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto [scrollbar-gutter:stable]">
          <div className="relative flex" style={{ height: 24 * HOUR }}>
            {/* A line across every day at each hour. */}
            {Array.from({ length: 23 }, (_, i) => (
              <div key={i} className="pointer-events-none absolute right-0 left-14 border-t" style={{ top: (i + 1) * HOUR }} />
            ))}
            <div className="relative w-14 shrink-0">
              {Array.from({ length: 23 }, (_, i) => (
                <span key={i} className="absolute right-2 -translate-y-1/2 text-xs tabular-nums text-muted-foreground" style={{ top: (i + 1) * HOUR }}>
                  {hourLabel(i + 1)}
                </span>
              ))}
            </div>
            {days.map((key) => {
              const timed = (byDay.get(key) ?? []).filter((e) => !e.allDay);
              return (
                <div key={key} className="relative min-w-0 flex-1 border-l">
                  {layoutDay(key, timed).map(({ event, top, bottom, col, cols }) => {
                    const height = ((bottom - top) / 60) * HOUR;
                    return (
                      <EventChip
                        key={event.id}
                        event={event}
                        className="absolute flex flex-col px-1.5 py-1 ring-1 ring-background"
                        style={{ top: (top / 60) * HOUR + 1, height: height - 2, left: `calc(${(col / cols) * 100}% + 2px)`, width: `calc(${100 / cols}% - 4px)` }}
                      >
                        <span className={cn("font-medium break-words", height < 40 ? "truncate" : "line-clamp-2")}>{event.title}</span>
                        {height >= 40 && <span className="truncate tabular-nums text-muted-foreground">{timeOf(event.startsAt)}</span>}
                      </EventChip>
                    );
                  })}
                  {key === todayKey && (
                    <div className="pointer-events-none absolute inset-x-0 z-10 flex items-center" style={{ top: (nowMinutes / 60) * HOUR }}>
                      <span className="-ml-1 size-2 rounded-full bg-red-500" />
                      <span className="h-px flex-1 bg-red-500" />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

/** The month as a grid of dates, with the selected month's events listed down the right. */
function MonthView({
  days,
  byDay,
  today,
  selected,
  onSelect,
  empty,
}: {
  days: string[];
  byDay: Map<string, CalendarEvent[]>;
  today: Date;
  selected: Date;
  onSelect: (d: Date) => void;
  empty: React.ReactNode;
}) {
  const listRef = useRef<HTMLDivElement>(null);
  const todayKey = dayKey(today);
  const selectedKey = dayKey(selected);
  const month = selected.getMonth();
  const inMonth = days.filter((key) => fromKey(key).getMonth() === month);
  const listed = inMonth.filter((key) => byDay.has(key) || key === selectedKey);
  const weekdays = days.slice(0, 7).map((key) => fromKey(key).toLocaleDateString("en-GB", { weekday: "short" }));

  // The list follows the date picked in the grid, where the list scrolls on its own.
  useEffect(() => {
    const list = listRef.current;
    const section = list?.querySelector<HTMLElement>(`[data-day="${selectedKey}"]`);
    if (!list || !section || list.scrollHeight <= list.clientHeight) return;
    // The list is the section's offset parent, so offsetTop is measured from the top of the list.
    list.scrollTo({ top: section.offsetTop - 12, behavior: "smooth" });
  }, [selectedKey]);

  return (
    <div className="flex h-full flex-col overflow-y-auto lg:flex-row lg:overflow-hidden">
      <div className="flex shrink-0 flex-col lg:min-h-0 lg:flex-1">
        <div className="grid shrink-0 grid-cols-7 border-b">
          {weekdays.map((w) => <span key={w} className="px-2 py-2 text-right text-xs text-muted-foreground">{w}</span>)}
        </div>
        <div className="grid grid-cols-7 grid-rows-6 lg:min-h-0 lg:flex-1">
          {days.map((key, i) => {
            const d = fromKey(key);
            const events = byDay.get(key) ?? [];
            const isToday = key === todayKey;
            const isSelected = key === selectedKey;
            const outside = d.getMonth() !== month;
            const shown = events.slice(0, 3);
            return (
              <button
                key={key}
                type="button"
                onClick={() => onSelect(d)}
                aria-label={d.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" })}
                aria-pressed={isSelected}
                className={cn(
                  "flex h-14 min-h-0 min-w-0 flex-col gap-0.5 overflow-hidden border-b p-1 text-left transition-colors outline-none hover:bg-muted/50 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:ring-inset lg:h-auto",
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
                {/* Titles on wide screens, a dot on phones. */}
                {events.length > 0 && <span className="mx-auto size-1.5 shrink-0 rounded-full bg-foreground/60 lg:hidden" />}
                <span className="hidden min-w-0 flex-col gap-0.5 lg:flex">
                  {shown.map((e) => (
                    <span key={e.id} className={cn("flex min-w-0 items-center gap-1 rounded-sm px-1 text-xs", e.allDay && "bg-secondary", outside && "text-muted-foreground")}>
                      <span className="min-w-0 flex-1 truncate">{e.title}</span>
                      {!e.allDay && <span className="shrink-0 tabular-nums text-muted-foreground">{timeOf(e.startsAt)}</span>}
                    </span>
                  ))}
                  {events.length > shown.length && <span className="px-1 text-xs text-muted-foreground">{events.length - shown.length} more</span>}
                </span>
              </button>
            );
          })}
        </div>
      </div>
      <div ref={listRef} className="relative flex shrink-0 flex-col gap-6 p-3 lg:w-80 lg:overflow-y-auto lg:border-l xl:w-96">
        {empty ??
          listed.map((key) => {
            const events = byDay.get(key) ?? [];
            return (
              <section key={key} data-day={key} className="space-y-2">
                <h2 className={cn("text-sm font-medium", key !== selectedKey && "text-muted-foreground")}>{dayTitle(key, today)}</h2>
                {events.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No events.</p>
                ) : (
                  <div className="rounded-lg border px-3">
                    {events.map((e, i) => (
                      <Fragment key={e.id}>
                        {i > 0 && <Separator />}
                        <div className="py-3"><EventDetails event={e} /></div>
                      </Fragment>
                    ))}
                  </div>
                )}
              </section>
            );
          })}
      </div>
    </div>
  );
}

export default function CalendarPage() {
  const { session } = useAuth();
  const userId = session?.user.id;
  const { accounts } = useApp();
  const [view, setView] = useState<View>("agenda");
  const [now, setNow] = useState(() => new Date());
  const today = useMemo(() => startOfDay(now), [now.getFullYear(), now.getMonth(), now.getDate()]); // eslint-disable-line react-hooks/exhaustive-deps
  // The selected day: the week view shows its week, the agenda its month.
  const [anchor, setAnchor] = useState(() => startOfDay(new Date()));
  const start = view === "week" ? startOfWeek(anchor) : startOfWeek(startOfMonth(anchor));
  const length = view === "week" ? 7 : 42;
  const startKey = dayKey(start);
  const rangeKey = `${startKey}+${length}`;
  // undefined while loading, null if it failed.
  const [loaded, setLoaded] = useState<{ key: string; events: CalendarEvent[] | null } | undefined>(undefined);
  // Goes up when an event made here has been created and stored, so the days shown reload.
  const [version, setVersion] = useState(0);
  const [newOpen, setNewOpen] = useState(false);

  // The time line and today move on while the page is left open.
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    const from = fromKey(startKey);
    loadEvents(from, addDays(from, length))
      .then((events) => !cancelled && setLoaded({ key: rangeKey, events }))
      .catch((err) => {
        console.error(err instanceof Error ? err.message : "Load events failed");
        if (!cancelled) setLoaded({ key: rangeKey, events: null });
      });
    return () => {
      cancelled = true;
    };
  }, [rangeKey, startKey, length, userId, version]);

  // The worker stores a new event in calendar_events before it marks the queued row created.
  useEffect(() => {
    if (!userId) return;
    const channel = supabase
      .channel(`calendar-page-${userId}`)
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "calendar_outbox" }, (payload) => {
        if ((payload.new as { status?: string }).status === "created") setVersion((v) => v + 1);
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [userId]);

  const days = useMemo(() => Array.from({ length }, (_, i) => dayKey(addDays(fromKey(startKey), i))), [startKey, length]);
  const events = loaded?.key === rangeKey ? loaded.events : undefined;
  const byDay = useMemo(() => {
    const map = new Map<string, CalendarEvent[]>();
    for (const e of events ?? []) for (const key of daysOf(e, days)) map.set(key, [...(map.get(key) ?? []), e]);
    for (const list of map.values()) list.sort(byTime);
    return map;
  }, [events, days]);

  const calendarConnected = accounts.some((a) => a.provider === "google_calendar");
  const todayKey = dayKey(today);
  const showingToday = view === "week" ? days.includes(todayKey) : dayKey(anchor) === todayKey;

  // A month away lands on its first day, or on today in today's month.
  const moveMonth = (n: number) => {
    const first = new Date(anchor.getFullYear(), anchor.getMonth() + n, 1);
    setAnchor(first.getMonth() === today.getMonth() && first.getFullYear() === today.getFullYear() ? today : first);
  };
  const move = (n: number) => (view === "week" ? setAnchor(addDays(anchor, 7 * n)) : moveMonth(n));
  const label = view === "week" ? rangeLabel(start, addDays(start, 7)) : anchor.toLocaleDateString("en-GB", { month: "long", year: "numeric" });
  const newEventDay = view === "week" ? (days.includes(todayKey) ? todayKey : startKey) : dayKey(anchor);

  const notConnected = !calendarConnected && events && events.length === 0 && (
    <div className="py-12">
      <EmptyState
        icon={CalendarDays}
        title="Nothing Scheduled"
        description="Connect Google Calendar in Settings to see your events here."
        action={<Button variant="outline" asChild><Link href="/settings/accounts">Connected Accounts</Link></Button>}
      />
    </div>
  );

  return (
    <div className="flex h-full flex-col">
      <div className="shrink-0 space-y-2 p-3">
        <div className="flex h-10 items-center justify-between gap-2">
          <h1 className="min-w-0 truncate text-lg font-medium">Calendar</h1>
          <div className="flex shrink-0 items-center gap-1">
            <Button onClick={() => setNewOpen(true)}>New Event</Button>
            <Button variant="outline" onClick={() => setAnchor(today)} disabled={showingToday}>Today</Button>
            <Button variant="ghost" size="icon" aria-label={view === "week" ? "Previous Week" : "Previous Month"} onClick={() => move(-1)}>
              <ChevronLeft />
            </Button>
            <Button variant="ghost" size="icon" aria-label={view === "week" ? "Next Week" : "Next Month"} onClick={() => move(1)}>
              <ChevronRight />
            </Button>
          </div>
        </div>
        <div className="flex items-center justify-between gap-2">
          <Tabs value={view} onValueChange={(v) => setView(v as View)} className="shrink-0">
            <TabsList aria-label="View">
              <TabsTrigger value="agenda" className="px-3">Agenda</TabsTrigger>
              <TabsTrigger value="week" className="px-3">Week</TabsTrigger>
            </TabsList>
          </Tabs>
          <span className="truncate text-sm text-muted-foreground tabular-nums">{label}</span>
        </div>
      </div>

      <div className="min-h-0 flex-1 border-t">
        {events === undefined && (
          <div className="flex flex-col gap-3 p-3" aria-label="Loading events">
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-96 w-full rounded-lg" />
          </div>
        )}
        {events === null && (
          <div className="py-24">
            <EmptyState icon={CalendarDays} title="Events Did Not Load" description="Check your connection, then reload." />
          </div>
        )}
        {events && view === "agenda" && (
          <MonthView days={days} byDay={byDay} today={today} selected={anchor} onSelect={setAnchor} empty={notConnected || null} />
        )}
        {events && view === "week" && <WeekView days={days} byDay={byDay} today={today} now={now} />}
      </div>
      <NewEventDialog open={newOpen} onOpenChange={setNewOpen} day={newEventDay} />
    </div>
  );
}
