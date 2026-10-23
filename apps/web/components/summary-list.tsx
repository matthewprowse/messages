"use client";

import { Children, Fragment, isValidElement, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { CalendarDays, CircleCheck } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { useApp } from "@/lib/store";
import { dayKey, daysOf, loadEvents, type CalendarEvent } from "@/lib/calendar";
import type { ListFilter, Thread } from "@/lib/types";
import { longDate, timeOf } from "@/lib/format";
import { shortcutAction } from "@/lib/selection";
import { digest, summarise } from "@/lib/summary";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/primitives";
import { SelectionBar, ThreadRow, useThreadSelection } from "@/components/thread-list";
import { BriefPlayer } from "@/components/brief-player";

// The Summary list looks and behaves like the Conversations list: same header, rows (ThreadRow itself),
// hover actions, context menu, checkboxes and shortcuts. Rows open beside it under /briefing.

const FILTER_OPTIONS: { key: ListFilter; label: string }[] = [
  { key: "none", label: "No Filter" },
  { key: "unread", label: "Unread" },
  { key: "email", label: "Email" },
  { key: "whatsapp", label: "WhatsApp" },
];

const BASE = "/briefing";

function listHref(filter: ListFilter) {
  return filter === "none" ? BASE : `${BASE}?filter=${filter}`;
}

function useListState() {
  const params = useSearchParams();
  const raw = params.get("filter") as ListFilter | null;
  const filter: ListFilter = raw && FILTER_OPTIONS.some((o) => o.key === raw) ? raw : "none";
  // A message jumped to from search belongs to one conversation, so it is not carried into list links.
  const query = new URLSearchParams(params);
  query.delete("message");
  return { filter, query: query.toString() };
}

/** An event row's second line: when, where and who, such as "09:00 to 10:00 · Office · Sarah Lee". */
function eventDetail(e: CalendarEvent) {
  const who = e.attendees.map((a) => a.name).join(", ");
  // All Day already sits on the right, so an all-day event's line starts with where.
  const when = e.allDay ? "" : e.endsAt && e.endsAt !== e.startsAt ? `${timeOf(e.startsAt)} to ${timeOf(e.endsAt)}` : timeOf(e.startsAt);
  return [when, e.location, who].filter(Boolean).join(" · ") || "All Day";
}

// Laid out like a conversation row: an avatar-sized icon, a title line and a detail line. Events are not
// tied to a conversation, so the row opens the Calendar.
function EventRow({ event, today }: { event: CalendarEvent; today: string }) {
  // A timed event that began before today is already under way.
  const when = event.allDay ? "All Day" : dayKey(new Date(event.startsAt)) < today ? "Ongoing" : timeOf(event.startsAt);
  return (
    <Link
      href="/calendar"
      data-row-link
      data-event-row
      className="flex scroll-mt-[104px] items-center gap-3 rounded-lg p-3 outline-none hover:bg-muted/50 focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:ring-inset"
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

function Section({ title, count, children }: { title: string; count: number; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-2" aria-label={title}>
      <h2 className="flex h-8 items-center gap-2 px-3 text-sm font-medium">
        {title}
        <Badge variant="secondary">{count}</Badge>
      </h2>
      {children}
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
 * last events loaded stay up while a refetch or a new day's load runs, and when one fails.
 */
function useTodaysEvents(now: Date) {
  const { session } = useAuth();
  const userId = session?.user.id;
  const today = dayKey(now);
  const tick = Math.floor(now.getTime() / (EVENTS_REFRESH_MINUTES * 60_000));
  const [loaded, setLoaded] = useState<CalendarEvent[]>();

  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    const [y, m, d] = today.split("-").map(Number);
    loadEvents(new Date(y, m - 1, d), new Date(y, m - 1, d + 1))
      .then((events) => !cancelled && setLoaded(events))
      .catch((err) => {
        console.error(err instanceof Error ? err.message : "Load events failed");
        if (!cancelled) setLoaded((prev) => prev ?? []);
      });
    return () => {
      cancelled = true;
    };
  }, [userId, today, tick]);

  return loaded
    ?.filter((e) => daysOf(e, [today]).length > 0)
    .filter((e) => e.allDay || (e.endsAt ? new Date(e.endsAt) : new Date(Date.parse(e.startsAt) + NO_END_MINUTES * 60_000)) > now)
    .sort((a, b) => Number(b.allDay) - Number(a.allDay) || a.startsAt.localeCompare(b.startsAt));
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
  const { threads, loading, contactById: contactOf, prefetchMessages } = useApp();
  const rowsRef = useRowNavigation<HTMLDivElement>();

  // Today, the sections' time windows and finished events move on while the page is left open.
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(timer);
  }, []);

  const sections = useMemo(() => summarise(threads, filter, now), [threads, filter, now]);
  const allEvents = useTodaysEvents(now);
  // Events are not email or WhatsApp, and never unread, so any filter leaves them out.
  const events = filter === "none" ? allEvents ?? [] : [];
  const order = [...sections.reply, ...sections.priority, ...sections.updates].map((t) => t.id);
  // Conversations show as soon as they are ready; the calendar section joins when its events arrive.
  const busy = loading;
  const line = digest(sections, events.length);

  const { picked, setChecked, check, run, onRowAction } = useThreadSelection(order, query, filter, BASE);
  // The spoken brief's script, shown once it has been played.
  const [script, setScript] = useState<string | null>(null);
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
          checked={picked.includes(t.id)}
          selecting={picked.length > 0}
          onCheck={check}
          onAction={onRowAction}
          onPress={prefetchMessages}
          baseHref={BASE}
          summary={t.summary.trim() || undefined}
        />
      ))}
    </Separated>
  );

  return (
    // The scrollbar starts below the 104px floating header instead of running behind it.
    <ScrollArea className="h-full" scrollbarClassName="data-vertical:top-[104px]! data-vertical:h-auto!">
      {/* Rows scroll underneath this header and show through it faintly. */}
      <div className="sticky top-0 z-10 space-y-2 bg-background/70 p-3 backdrop-blur-xl backdrop-saturate-150">
        <h1 className="flex h-10 items-center text-lg font-medium">Summary</h1>
        {picked.length > 0 ? (
          <SelectionBar
            allPicked={picked.length === order.length}
            anyUnread={threads.some((t) => t.unread && picked.includes(t.id))}
            onAll={() => setChecked(order)}
            onClear={() => setChecked([])}
            onAction={(action) => run(picked, action)}
          />
        ) : (
          <div className="flex items-center justify-between gap-2">
            <span className="min-w-0 flex-1 truncate pl-3 text-sm text-muted-foreground">{longDate(now.toISOString())}</span>
            <BriefPlayer onScript={setScript} />
            <Select value={filter === "none" ? "" : filter} onValueChange={(v) => router.push(listHref(v as ListFilter))}>
              <SelectTrigger aria-label="Filter" className="w-36 data-[size=default]:h-8">
                <SelectValue placeholder="Filter" />
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
      <div ref={rowsRef} className="px-3 pb-3">
        {busy && (
          <div className="flex flex-col gap-2" aria-label="Loading summary">
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
        {script && <p className="mb-4 whitespace-pre-line px-3 text-sm">{script}</p>}
        {!busy && !line && (
          <div className="py-24">
            <EmptyState
              icon={CircleCheck}
              title="You're All Caught Up"
              description={filter === "none" ? "Replies waiting on you, urgent conversations and today's events appear here." : "Nothing that needs you matches this filter."}
            />
          </div>
        )}
        {!busy && line && (
          <div className="flex flex-col gap-4">
            <p className="px-3 text-sm text-muted-foreground">{line}</p>
            {sections.reply.length > 0 && <Section title="Needs Reply" count={sections.reply.length}>{rows(sections.reply)}</Section>}
            {sections.priority.length > 0 && <Section title="Urgent and Important" count={sections.priority.length}>{rows(sections.priority)}</Section>}
            {events.length > 0 && (
              <Section title="Today's Calendar" count={events.length}>
                <Separated>{events.map((e) => <EventRow key={e.id} event={e} today={today} />)}</Separated>
              </Section>
            )}
            {sections.updates.length > 0 && <Section title="Updates" count={sections.updates.length}>{rows(sections.updates)}</Section>}
          </div>
        )}
      </div>
    </ScrollArea>
  );
}
