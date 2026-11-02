"use client";

// The Summary list looks and behaves like the Conversations list: same header, rows (ThreadRow itself),
// hover actions, context menu, checkboxes and shortcuts. Rows open beside it under /summary. The sections and rows
// are in components/summary/; this file wires them to the store.

import { useEffect, useMemo, useState } from "react";
import { track } from "@/lib/analytics";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { useApp } from "@/lib/store";
import { dayKey } from "@/lib/calendar";
import type { ListFilter, Thread } from "@/lib/types";
import { longDate } from "@/lib/format";
import { shortcutAction } from "@/lib/selection";
import { digest, summarise } from "@/lib/summary";
import { FILTER_OPTIONS, filterOf, listHref, SUMMARY_BASE as BASE } from "@/lib/summary-list";
import { tasksForToday } from "@/lib/tasks";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { providerLabel } from "@/components/primitives";
import { useImporting } from "@/components/sync-bar";
import { SelectionBar, ThreadRow, useSwipedRow, useThreadSelection } from "@/components/thread-list";
import { BriefPlayer } from "@/components/brief-player";
import { CalendarBody } from "@/components/summary/calendar-body";
import { Section, Separated } from "@/components/summary/section";
import { LoadingSummary, SummaryEmpty } from "@/components/summary/summary-empty";
import { TaskRow } from "@/components/summary/task-row";
import { useHeaderHeight } from "@/components/summary/use-header-height";
import { useRowNavigation } from "@/components/summary/use-row-navigation";
import { useStuckBands } from "@/components/summary/use-stuck-bands";
import { useTodaysEvents } from "@/components/summary/use-todays-events";

function useListState() {
  const params = useSearchParams();
  const filter: ListFilter = filterOf(params.get("filter"));
  useEffect(() => {
    if (filter !== "none") track("feature_used", { feature: "summary_filter", detail: filter });
  }, [filter]);
  // Row links carry only what the list needs to come back to: the filter. Anything else in the address
  // (a message jumped to from search, a stray key) belongs to the page it was on.
  return { filter, query: filter === "none" ? "" : `filter=${filter}` };
}

export function SummaryList() {
  const { filter, query } = useListState();
  const params = useParams<{ id?: string }>();
  const router = useRouter();
  const { threads, accounts, tasks, loading, contactById: contactOf, prefetchMessages } = useApp();
  const rowsRef = useRowNavigation<HTMLDivElement>();
  const { headerRef, headerHeight } = useHeaderHeight();

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
  useStuckBands(rowsRef, [sections, events.length, todaysTasks.length, busy, calendarShown]);

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
        {busy && <LoadingSummary />}
        {!busy && empty && <SummaryEmpty noAccounts={noAccounts} importing={importing} filter={filter} onClearFilter={() => router.push(BASE)} />}
        {!busy && !empty && (
          <div>
            {calendarShown && (
              <Section title="Today's Calendar" count={calendarFailed || calendarPending ? undefined : events.length} separated>
                <CalendarBody failed={calendarFailed} pending={calendarPending} events={events} today={today} onRetry={retryCalendar} />
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