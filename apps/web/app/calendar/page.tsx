"use client";

// The Calendar page: agenda, week and day views of events and tasks from every connected account.
// View, date and open event live in the address (?view, ?date, ?event), so a reload or shared link opens the same place.


import { Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { ArrowLeft, ArrowRight, CalendarDays } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { useApp } from "@/lib/store";
import { visibleEvents } from "@/lib/event-filter";
import { buildResponse, dayKey, daysOf, followUpdate, loadEventDetail, loadEvents, withPatch, type CalendarEvent, type EventPatch, type EventResponse, type UpdateScope } from "@/lib/calendar";
import { supabase } from "@/lib/supabase";
import { tasksByDay, type DayTask } from "@/lib/tasks";
import type { Task } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { PaneControls, PaneHeader, SearchBand, ViewButtons } from "@/components/pane";
import { EmptyState, providerLabel } from "@/components/primitives";
import { NewEventDialog } from "@/components/new-event-dialog";
import { NewTaskDialog } from "@/components/new-task-dialog";
import { DeleteEventDialog, type DeleteScope } from "@/components/delete-event-dialog";

import { DAY_MIN, LABELS, View, addDays, byTime, fromKey, parseKey, rangeLabel, startOfDay, startOfMonth, startOfWeek } from "@/components/calendar/dates";
import { EventDialog } from "@/components/calendar/event-details";
import { EventList } from "@/components/calendar/event-list";
import { MonthView } from "@/components/calendar/month-view";
import { Page, PageContext, useWide } from "@/components/calendar/page-context";
import { TaskDialog } from "@/components/calendar/task-parts";
import { WeekView } from "@/components/calendar/week-view";

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
  // A change the worker has not confirmed after a minute may still land: the days load again a while later, and what
  // is still missing from them is then dropped from the page.
  const later = useCallback((settle: () => void) => {
    setTimeout(() => {
      if (!mounted.current) return;
      settle();
      reload();
    }, 30_000);
  }, [reload]);

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
        if (cancelled) return;
        // A failed refresh keeps the events already shown; only a first load with nothing to show reports the error.
        setLoaded((prev) => ({ key: rangeKey, events: prev?.events ?? null }));
        toast.error("Events did not load. Try again in a moment.");
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
  // Closing an event (or opening another) forgets a failed load, so opening it again tries again.
  useEffect(() => {
    setDetailsFailed((set) => {
      const stale = [...set].filter((id) => id !== openId);
      if (!stale.length) return set;
      for (const id of stale) requested.current.delete(id);
      return new Set([...set].filter((id) => id === openId));
    });
  }, [openId]);
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
    const shown = visibleEvents(all, term, hidden);
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
          action={<Button variant="secondary" asChild><Link href="/settings/accounts">Connected Accounts</Link></Button>}
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
  );
}

export default function CalendarPage() {
  return (
    <Suspense fallback={null}>
      <CalendarPageContent />
    </Suspense>
  );
}
