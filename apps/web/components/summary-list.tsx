"use client";

import { Children, Fragment, isValidElement, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { track } from "@/lib/analytics";
import Link from "next/link";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { CalendarDays, CalendarX, CircleCheck, Link2, RefreshCw } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { useApp } from "@/lib/store";
import { dayKey, daysOf, eventDetail, loadEvents, type CalendarEvent } from "@/lib/calendar";
import type { ListFilter, Thread } from "@/lib/types";
import { longDate, timeOf } from "@/lib/format";
import { shortcutAction } from "@/lib/selection";
import { digest, summarise } from "@/lib/summary";
import { taskDetail, tasksForToday, taskWhen, type DayTask } from "@/lib/tasks";
import { Checkbox } from "@/components/ui/checkbox";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { EmptyState, providerLabel } from "@/components/primitives";
import { useImporting } from "@/components/sync-bar";
import { SelectionBar, ThreadRow, useSwipedRow, useThreadSelection } from "@/components/thread-list";
import { BriefPlayer } from "@/components/brief-player";

// The Summary list looks and behaves like the Conversations list: same header, rows (ThreadRow itself),
// hover actions, context menu, checkboxes and shortcuts. Rows open beside it under /summary.

const FILTER_OPTIONS: { key: ListFilter; label: string }[] = [
  { key: "none", label: "All" },
  { key: "unread", label: "Unread" },
  { key: "email", label: "Email" },
  { key: "whatsapp", label: "WhatsApp" },
];

const BASE = "/summary";

function listHref(filter: ListFilter) {
  return filter === "none" ? BASE : `${BASE}?filter=${filter}`;
}

function useListState() {
  const params = useSearchParams();
  const raw = params.get("filter") as ListFilter | null;
  const filter: ListFilter = raw && FILTER_OPTIONS.some((o) => o.key === raw) ? raw : "none";
  useEffect(() => {
    if (filter !== "none") track("feature_used", { feature: "summary_filter", detail: filter });
  }, [filter]);
  // Row links carry only what the list needs to come back to: the filter. Anything else in the address
  // (a message jumped to from search, a stray key) belongs to the page it was on.
  return { filter, query: filter === "none" ? "" : `filter=${filter}` };
}

// Laid out like a conversation row: an avatar-sized icon, a title line and a detail line. Events are not
// tied to a conversation, so the row opens the Calendar.
function EventRow({ event, today }: { event: CalendarEvent; today: string }) {
  // A timed event that began before today is already under way.
  const when = event.allDay ? "All Day" : dayKey(new Date(event.startsAt)) < today ? "Ongoing" : timeOf(event.startsAt);
  return (
    <Link
      href={`/calendar?date=${today}&event=${encodeURIComponent(event.id)}`}
      data-row-link
      data-event-row
      className="flex scroll-mt-[calc(var(--summary-header)+var(--summary-band))] items-center gap-3 rounded-lg p-3 outline-none hover:bg-muted/50 focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:ring-inset"
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
    </Link>
  );
}

// Laid out like an event row, with the task's checkbox where the icon goes. Ticking it shows at once; the row
// opens the task in Calendar.
function TaskRow({ item, today, source }: { item: DayTask; today: string; source: string | undefined }) {
  const { tickTask } = useApp();
  const { task, overdue } = item;
  return (
    <div className={cn("flex items-center gap-3 rounded-lg p-3 hover:bg-muted/50", task.pending && "opacity-60")}>
      <div className="flex size-8 shrink-0 items-center justify-center">
        <Checkbox checked={task.completed} onCheckedChange={(checked) => tickTask(task, checked === true, "summary")} aria-label={task.title} />
      </div>
      <Link
        href={`/calendar?date=${today}&task=${encodeURIComponent(task.id)}`}
        data-row-link
        data-event-row
        className="flex min-w-0 flex-1 scroll-mt-[calc(var(--summary-header)+var(--summary-band))] flex-col gap-1 rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
      >
        <div className="flex h-5 items-center justify-between gap-3">
          <span className={cn("min-w-0 truncate text-sm font-medium", task.completed && "line-through")}>{task.title}</span>
          <span className={cn("shrink-0 text-xs tabular-nums text-muted-foreground", overdue && !task.pending && "text-destructive")}>{taskWhen(item, timeOf)}</span>
        </div>
        <div className="flex h-4 items-center">
          <span className="min-w-0 truncate text-xs">{taskDetail(task, source)}</span>
        </div>
      </Link>
    </div>
  );
}

// A band like the search box in Conversations: padded, and separated below (the first section always, the rest once stuck). It sticks under
// the header while its section scrolls, and the next section's band pushes it up. Each section after the first
// has its own space above its band, so while the band above is still stuck there is room under its separator.
function Section({ title, count, separated = false, children }: { title: string; count?: number; separated?: boolean; children: React.ReactNode }) {
  return (
    <section className="not-first:pt-3 last:pb-3" aria-label={title}>
      <h2
        data-band
        className={cn(
          "sticky top-(--summary-header) z-[5] -mx-3 flex items-center gap-2 border-b bg-background p-3 text-sm font-medium",
          separated ? "border-border" : "border-transparent data-stuck:border-border",
        )}
      >
        <span className="flex h-8 items-center gap-2">
          {title}
          {count !== undefined && <Badge variant="secondary">{count}</Badge>}
        </span>
      </h2>
      <div className="pt-3">{children}</div>
    </section>
  );
}

/** Rows with a rule between each, inset past the avatar. Children keep their own keys. */
function Separated({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
      {Children.toArray(children).map((child, i) => (
        <Fragment key={isValidElement(child) ? child.key : i}>
          {i > 0 && <div className="pl-14"><Separator /></div>}
          {child}
        </Fragment>
      ))}
    </div>
  );
}

/** Refetches today's events this often, which also retries a failed load. */
const EVENTS_REFRESH_MINUTES = 5;
/** How long an event with no end time stays on the list after it starts. */
const NO_END_MINUTES = 60;

/**
 * Today's events that have not finished yet, all-day ones first. Undefined until the first load. The
 * last events loaded stay up while a refetch or a new day's load runs, and when one fails. `failed` is
 * set while the latest load has failed with nothing loaded to show, and `retry` loads again.
 */
// Today's events as last loaded, so the section is there at once when the page is opened again.
let todaysCache: { day: string; events: CalendarEvent[] } | null = null;

function useTodaysEvents(now: Date) {
  const { session } = useAuth();
  const userId = session?.user.id;
  const today = dayKey(now);
  const tick = Math.floor(now.getTime() / (EVENTS_REFRESH_MINUTES * 60_000));
  const [loaded, setLoaded] = useState<CalendarEvent[] | undefined>(() => (todaysCache?.day === today ? todaysCache.events : undefined));
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    const [y, m, d] = today.split("-").map(Number);
    loadEvents(new Date(y, m - 1, d), new Date(y, m - 1, d + 1))
      .then((events) => {
        if (cancelled) return;
        todaysCache = { day: today, events };
        setLoaded(events);
        setFailed(false);
      })
      .catch((err) => {
        console.error(err instanceof Error ? err.message : "Load events failed");
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [userId, today, tick, attempt]);

  const retry = useCallback(() => {
    setFailed(false);
    setAttempt((n) => n + 1);
  }, []);

  const events = useMemo(
    () =>
      loaded
        ?.filter((e) => daysOf(e, [today]).length > 0)
        .filter((e) => e.allDay || (e.endsAt ? new Date(e.endsAt) : new Date(Date.parse(e.startsAt) + NO_END_MINUTES * 60_000)) > now)
        .sort((a, b) => Number(b.allDay) - Number(a.allDay) || a.startsAt.localeCompare(b.startsAt)),
    [loaded, today, now],
  );
  return { events, failed: failed && !loaded, retry };
}

/**
 * J and K move keyboard focus down and up the rows, starting from the focused or open row, and Enter
 * then opens it. E and the other shortcuts act on the focused row.
 */
function useRowNavigation<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.metaKey || e.ctrlKey || e.altKey || (e.key !== "j" && e.key !== "k")) return;
      const target = e.target as HTMLElement | null;
      if (target?.closest("input, textarea, select, [contenteditable=true], [role=menu], [role=dialog], [role=listbox], [role=combobox]")) return;
      const rows = [...(ref.current?.querySelectorAll<HTMLElement>("[data-row-link]") ?? [])];
      if (rows.length === 0) return;
      const focused = rows.findIndex((r) => r === document.activeElement);
      const at = focused !== -1 ? focused : rows.findIndex((r) => r.getAttribute("aria-current") === "page");
      const next = at === -1 ? 0 : Math.min(rows.length - 1, Math.max(0, at + (e.key === "j" ? 1 : -1)));
      e.preventDefault();
      rows[next].focus({ preventScroll: true });
      // The row's scroll margin keeps it clear of the floating header.
      rows[next].scrollIntoView({ block: "nearest" });
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  return ref;
}

export function SummaryList() {
  const { filter, query } = useListState();
  const params = useParams<{ id?: string }>();
  const router = useRouter();
  const { threads, accounts, tasks, loading, contactById: contactOf, prefetchMessages } = useApp();
  const rowsRef = useRowNavigation<HTMLDivElement>();
  // The sticky header's height, which the section bands stick under and the scrollbar starts below. It
  // changes with the selection bar and the text size, so it is measured rather than assumed.
  const headerRef = useRef<HTMLDivElement>(null);
  const [headerHeight, setHeaderHeight] = useState(105);
  useLayoutEffect(() => {
    const header = headerRef.current;
    if (!header) return;
    const measure = () => setHeaderHeight(header.getBoundingClientRect().height);
    measure();
    const resized = new ResizeObserver(measure);
    resized.observe(header);
    return () => resized.disconnect();
  }, []);

  // Today, the sections' time windows and finished events move on while the page is left open.
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(timer);
  }, []);

  const sections = useMemo(() => summarise(threads, filter, now), [threads, filter, now]);
  const { events: loadedEvents, failed: calendarFailed, retry: retryCalendar } = useTodaysEvents(now);
  // The calendar is not filtered: events are neither email nor WhatsApp nor unread, but they are still today.
  const events = loadedEvents ?? [];
  // Nor are tasks: open ones due today, and overdue ones, from Microsoft To Do, Google Tasks and iCloud Reminders.
  const todaysTasks = useMemo(() => tasksForToday(tasks, now), [tasks, now]);
  const sourceOf = (accountId: string) => {
    const provider = accounts.find((a) => a.id === accountId)?.provider;
    return provider ? providerLabel[provider] : undefined;
  };
  const order = useMemo(() => [...sections.reply, ...sections.priority, ...sections.updates].map((t) => t.id), [sections]);
  // Conversations show as soon as they are ready; the calendar section joins when its events arrive.
  const busy = loading;
  // A new user with no account connected yet is pointed at connecting one.
  const noAccounts = !accounts.some((a) => a.status !== "disconnected");
  const importing = useImporting().length > 0;
  // The calendar section stands in for events still loading or failed to load, so neither reads as "nothing today".
  const calendarPending = !noAccounts && !calendarFailed && loadedEvents === undefined;
  const calendarShown = events.length > 0 || calendarFailed || calendarPending;
  const empty = !digest(sections, events.length, todaysTasks.length) && !calendarShown;

  const { picked, setChecked, check, run, onRowAction } = useThreadSelection(order, query, filter, BASE);
  // A section's band shows its separator only once it has left its place at the top of the section.
  useEffect(() => {
    const content = rowsRef.current;
    const viewport = content?.closest<HTMLElement>('[data-slot="scroll-area-viewport"]');
    if (!content || !viewport) return;
    const update = () => {
      for (const band of content.querySelectorAll<HTMLElement>("[data-band]")) {
        const section = band.parentElement;
        if (!section) continue;
        // Where the band sits when nothing has moved it: the section's top, below the section's own padding.
        const home = section.getBoundingClientRect().top + parseFloat(getComputedStyle(section).paddingTop);
        band.toggleAttribute("data-stuck", band.getBoundingClientRect().top - home > 0.5);
      }
    };
    update();
    viewport.addEventListener("scroll", update, { passive: true });
    const resized = new ResizeObserver(update);
    resized.observe(content);
    return () => {
      viewport.removeEventListener("scroll", update);
      resized.disconnect();
    };
  }, [rowsRef, sections, events.length, todaysTasks.length, busy, calendarShown]);

  const today = dayKey(now);

  // An event row has nothing to archive or delete, so with one focused the shortcuts do nothing at all,
  // rather than falling through to the open conversation.
  const nothingPicked = picked.length === 0;
  useEffect(() => {
    if (!nothingPicked) return;
    function onKey(e: KeyboardEvent) {
      if (!(e.target as HTMLElement | null)?.matches("[data-event-row]:focus-visible") || !shortcutAction(e)) return;
      e.preventDefault();
      e.stopPropagation();
    }
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [nothingPicked]);

  const pickedIds = new Set(picked);
  const rowSwipe = useSwipedRow();
  const rows = (items: Thread[]) => (
    <Separated>
      {items.map((t) => (
        <ThreadRow
          key={t.id}
          thread={t}
          today={today}
          contact={t.isGroup ? undefined : contactOf(t.participantIds[0])}
          query={query}
          selected={params.id === t.id}
          checked={pickedIds.has(t.id)}
          selecting={picked.length > 0}
          onCheck={check}
          onAction={onRowAction}
          onPress={prefetchMessages}
          baseHref={BASE}
          summary={t.summary.trim() || undefined}
          swiped={rowSwipe.swiped === t.id}
          onSwipe={rowSwipe.onSwipe}
          onTouchRow={rowSwipe.onTouchRow}
        />
      ))}
    </Separated>
  );

  return (
    // The scrollbar starts below the sticky header and the section band, and sits above the bands that
    // scroll past it so none of them hides it.
    <ScrollArea
      className="h-full"
      style={{ "--summary-header": `${headerHeight}px`, "--summary-band": "57px" } as React.CSSProperties}
      scrollbarClassName="z-20 data-vertical:top-[calc(var(--summary-header)+var(--summary-band))]! data-vertical:h-auto!"
    >
      {/* Plain white like the Conversations header, so the rows scrolling under it do not show through. */}
      <div ref={headerRef} className="sticky top-0 z-10 space-y-3 border-b bg-background p-3">
        <div className="flex h-8 items-center justify-between gap-3">
          <h1 className="flex h-8 items-center text-lg font-medium">Summary</h1>
          <BriefPlayer />
        </div>
        {picked.length > 0 ? (
          <SelectionBar
            allPicked={picked.length === order.length}
            anyUnread={threads.some((t) => t.unread && pickedIds.has(t.id))}
            onAll={() => setChecked(order)}
            onClear={() => setChecked([])}
            onAction={(action) => run(picked, action)}
          />
        ) : (
          <div className="flex items-center justify-between gap-2">
            <span className="min-w-0 truncate text-sm text-muted-foreground">{longDate(now.toISOString())}</span>
            <Select value={filter} onValueChange={(v) => router.push(listHref(v as ListFilter))}>
              <SelectTrigger aria-label="Filter" className="w-36 data-[size=default]:h-8">
                <SelectValue />
              </SelectTrigger>
              <SelectContent align="end">
                {FILTER_OPTIONS.map((o) => (
                  <SelectItem key={o.key} value={o.key}>{o.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
      </div>
      <div ref={rowsRef} className="px-3">
        {busy && (
          <div role="status" aria-busy="true" className="flex flex-col gap-2 py-3" aria-label="Loading summary">
            {Array.from({ length: 8 }, (_, i) => (
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
        {!busy && empty && noAccounts && (
          <div className="py-24">
            <EmptyState
              icon={Link2}
              title="Connect an Account"
              description="Connect Gmail, WhatsApp or iCloud to see what needs you here."
              action={<Button asChild><Link href="/settings/accounts">Connect an Account</Link></Button>}
            />
          </div>
        )}
        {!busy && empty && !noAccounts && importing && filter === "none" && (
          <div className="py-24">
            <EmptyState icon={RefreshCw} title="Importing Your Messages" description="What needs you appears here as your messages arrive. The first import can take a few minutes." />
          </div>
        )}
        {!busy && empty && !noAccounts && !(importing && filter === "none") && (
          <div className="py-24">
            <EmptyState
              icon={CircleCheck}
              title="You're All Caught Up"
              description={filter === "none" ? "Replies waiting on you, urgent conversations, today's events and tasks appear here." : "Nothing that needs you matches this filter."}
              action={filter !== "none" ? <Button variant="outline" onClick={() => router.push(BASE)}>Clear Filter</Button> : undefined}
            />
          </div>
        )}
        {!busy && !empty && (
          <div>
            {calendarShown && (
              <Section title="Today's Calendar" count={calendarFailed || calendarPending ? undefined : events.length} separated>
                {calendarFailed ? (
                  <div className="flex items-center gap-3 p-3" role="alert">
                    <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-muted">
                      <CalendarX className="size-4" />
                    </div>
                    <span className="min-w-0 flex-1 truncate text-sm font-medium">Couldn&apos;t Load Calendar</span>
                    <Button variant="outline" size="sm" onClick={retryCalendar}>Retry</Button>
                  </div>
                ) : calendarPending ? (
                  <div role="status" aria-busy="true" aria-label="Loading calendar" className="flex items-center gap-3 p-3">
                    <Skeleton className="size-8 shrink-0 rounded-full" />
                    <div className="flex flex-1 flex-col gap-1">
                      <Skeleton className="h-5 w-1/2" />
                      <Skeleton className="h-4 w-2/3" />
                    </div>
                  </div>
                ) : (
                  <Separated>{events.map((e) => <EventRow key={e.id} event={e} today={today} />)}</Separated>
                )}
              </Section>
            )}
            {todaysTasks.length > 0 && (
              <Section title="Tasks" count={todaysTasks.length} separated={!calendarShown}>
                <Separated>{todaysTasks.map((t) => <TaskRow key={t.task.id} item={t} today={today} source={sourceOf(t.task.accountId)} />)}</Separated>
              </Section>
            )}
            {sections.reply.length > 0 && <Section title="Needs Reply" count={sections.reply.length} separated={!calendarShown && todaysTasks.length === 0}>{rows(sections.reply)}</Section>}
            {sections.priority.length > 0 && <Section title="Important" count={sections.priority.length}>{rows(sections.priority)}</Section>}
            {sections.updates.length > 0 && <Section title="Updates" count={sections.updates.length}>{rows(sections.updates)}</Section>}
          </div>
        )}
      </div>
    </ScrollArea>
  );
}
