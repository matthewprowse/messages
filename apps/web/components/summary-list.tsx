"use client";

// The Summary list looks and behaves like the Conversations list: same header, rows (ThreadRow itself),
// hover actions, context menu, checkboxes and shortcuts. Rows open beside it under /summary. The sections and rows
// are in components/summary/; this file wires them to the store. The section rules are in lib/summary.ts.

import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { track } from "@/lib/analytics";
import { SearchX } from "lucide-react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { useApp } from "@/lib/store";
import { dayKey } from "@/lib/calendar";
import type { ListFilter, Thread } from "@/lib/types";
import { dayDate } from "@/lib/format";
import { shortcutAction } from "@/lib/selection";
import { isSnoozed, tomorrowMorning } from "@/lib/snooze";
import { digest, olderWaiting, summarise } from "@/lib/summary";
import { filterOf, filterOptions, listHref, OLDER_SHOWN, SUMMARY_BASE as BASE } from "@/lib/summary-list";
import { channelsOf, matchesSearch } from "@/lib/thread-list";
import { tasksForToday } from "@/lib/tasks";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { EmptyState, providerLabel } from "@/components/primitives";
import { SearchBand } from "@/components/pane";
import { AccountsNotice } from "@/components/summary/accounts-notice";
import { useAdvanceAfterDone } from "@/components/summary/use-advance-after-done";
import { useNow } from "@/components/summary/use-now";
import { useImporting } from "@/components/sync-bar";
import { ManageLabelsHost } from "@/components/labels/manage-labels-dialog";
import { useSnoozePick } from "@/components/snooze/use-snooze-pick";
import { SelectionBar, ThreadRow, useSwipedRow, useThreadSelection } from "@/components/thread-list";
import { BriefPlayer } from "@/components/brief-player";
import { SummaryFilter } from "@/components/summary/summary-filter";
import { CalendarBody } from "@/components/summary/calendar-body";
import { Section, Separated } from "@/components/summary/section";
import { LoadingSummary, SummaryEmpty } from "@/components/summary/summary-empty";
import { TaskRow } from "@/components/summary/task-row";
import { PromisesSection } from "@/components/summary/promises-section";
import { useBandHeight, useHeaderHeight } from "@/components/summary/use-header-height";
import { useRowNavigation } from "@/components/summary/use-row-navigation";
import { useTodaysEvents } from "@/components/summary/use-todays-events";

/** The sections' time windows are days and hours wide, so they are re-derived this often, not every minute. */
const SECTIONS_REFRESH_MS = 5 * 60_000;
/** Finished events leave the list, so the calendar keeps closer time. */
const EVENTS_CLOCK_MS = 60_000;

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
  const { threads, accounts, tasks, loading, contactById: contactOf, threadById, prefetchMessages, snoozeClock, labels: labelApi } = useApp();
  const rowsRef = useRowNavigation<HTMLDivElement>();
  const { headerRef, headerHeight } = useHeaderHeight();

  // Today, the sections' time windows and finished events move on while the page is left open. The sections tick
  // slowly (a window is hours wide); only the events list needs the minute.
  const now = useNow(SECTIONS_REFRESH_MS);
  const eventsNow = useNow(EVENTS_CLOCK_MS);

  // A snoozed conversation returns on the minute it falls due, not at the next slow tick of `now`.
  const sectionsNow = useMemo(() => new Date(), [now, snoozeClock]);
  // The search narrows conversations by name, subject and latest message, and events and tasks by title.
  const [search, setSearch] = useState("");
  const term = useDeferredValue(search.trim().toLowerCase());
  const found = useMemo(() => (term ? threads.filter((t) => matchesSearch(t, term, (x) => contactOf(x.participantIds[0])?.name)) : threads), [threads, term, contactOf]);
  const sections = useMemo(() => summarise(found, filter, sectionsNow), [found, filter, sectionsNow]);
  const older = useMemo(() => olderWaiting(found, filter, sectionsNow), [found, filter, sectionsNow]);
  // Older is collapsed to its newest few, so the page's own sections stay in view.
  const [allOlder, setAllOlder] = useState(false);
  const olderShown = allOlder ? older : older.slice(0, OLDER_SHOWN);
  // The filter offers the channels you have conversations on, not a fixed list.
  const options = useMemo(() => filterOptions(channelsOf(threads)), [threads]);
  const { events: loadedEvents, failed: calendarFailed, retry: retryCalendar } = useTodaysEvents(eventsNow);
  // The calendar is not filtered: events are neither email nor WhatsApp nor unread, but they are still today.
  const events = useMemo(() => (loadedEvents ?? []).filter((e) => !term || e.title.toLowerCase().includes(term)), [loadedEvents, term]);
  // Nor are tasks: open ones due today, and overdue ones, from Microsoft To Do, Google Tasks and iCloud Reminders.
  const todaysTasks = useMemo(() => tasksForToday(tasks, now).filter((t) => !term || t.task.title.toLowerCase().includes(term)), [tasks, now, term]);
  const sourceOf = (accountId: string) => {
    const provider = accounts.find((a) => a.id === accountId)?.provider;
    return provider ? providerLabel[provider] : undefined;
  };
  const order = useMemo(() => [...sections.reply, ...sections.priority, ...sections.updates, ...sections.waiting, ...olderShown].map((t) => t.id), [sections, olderShown]);
  // Conversations show as soon as they are ready; the calendar section joins when its events arrive.
  const busy = loading;
  // A new user with no account connected yet is pointed at connecting one.
  const noAccounts = !accounts.some((a) => a.status !== "disconnected");
  const importing = useImporting().length > 0;
  // The calendar section stands in for events still loading or failed to load, so neither reads as "nothing today".
  const calendarPending = !noAccounts && !calendarFailed && loadedEvents === undefined;
  const calendarShown = events.length > 0 || calendarFailed || calendarPending;
  const headline = digest(sections, events.length, todaysTasks.length);
  const empty = !headline && !calendarShown && older.length === 0;
  const stalled = noAccounts ? 0 : accounts.filter((a) => a.status === "disconnected" || a.status === "error").length;

  // A row's Done for Now snoozes to tomorrow at 08:00 with no questions; the bulk bar's Snooze opens the choices instead.
  const { picked, setChecked, check, run, onRowAction } = useThreadSelection(order, query, filter, BASE, false, (ids, go) => go(ids, "snooze", tomorrowMorning(new Date())));
  const snoozePick = useSnoozePick(run);
  const pickLatest = useRef({ picked, snoozePick });
  pickLatest.current = { picked, snoozePick };
  const onSnooze = useCallback((id: string, mode: "snooze" | "remind", at: Date | "pick") => {
    const { picked, snoozePick } = pickLatest.current;
    const ids = picked.includes(id) ? picked : [id];
    if (at === "pick") snoozePick.request(ids, mode, "date"); else snoozePick.snoozeAt(ids, at, mode);
  }, []);
  const today = dayKey(now);
  const bandHeight = useBandHeight(rowsRef, `${busy}${empty}${calendarShown}${todaysTasks.length > 0}${sections.reply.length > 0}`);

  // Archiving, deleting or answering the open conversation opens the next row, so triage can run down the list.
  const open = params.id ? threadById(params.id) : undefined;
  useAdvanceAfterDone(order, params.id, !!params.id && (!open || open.status !== "inbox" || open.junk || (open.lastFromMe && filter !== "waiting") || isSnoozed(open)), filter);

  // One event a visit, once everything has loaded, so "do summaries save reading" can be answered from thread_opened.
  const shown = useRef(false);
  useEffect(() => {
    if (busy || calendarPending || shown.current) return;
    shown.current = true;
    track("summary_shown", { reply: sections.reply.length, priority: sections.priority.length, updates: sections.updates.length, older: older.length, events: events.length, tasks: todaysTasks.length });
  }, [busy, calendarPending, sections, older, events.length, todaysTasks.length]);

  // An event row has nothing to archive or delete, so with one focused the shortcuts do nothing at all,
  // rather than falling through to the open conversation.
  const nothingPicked = picked.length === 0;
  useEffect(() => {
    if (!nothingPicked) return;
    function onKey(e: KeyboardEvent) {
      // :focus, not :focus-visible, so a row focused by a click blocks them too.
      if (!(e.target as HTMLElement | null)?.matches("[data-event-row]:focus") || !shortcutAction(e)) return;
      e.preventDefault();
      e.stopPropagation();
    }
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [nothingPicked]);

  const pickedIds = useMemo(() => new Set(picked), [picked]);
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
          onSnooze={onSnooze}
          doneForNow
          labels={labelApi.labelsOf(t.id)}
          pickedIds={pickedIds.has(t.id) ? picked : undefined}
        />
      ))}
    </Separated>
  );

  return (
    // The scrollbar starts below the sticky header and the section band, and sits above the bands that
    // scroll past it so none of them hides it.
    <ScrollArea
      className="h-full"
      style={{ "--summary-header": `${headerHeight}px`, "--summary-band": `${bandHeight}px` } as React.CSSProperties}
      scrollbarClassName="z-20 data-vertical:top-[calc(var(--summary-header)+var(--summary-band))]! data-vertical:h-auto!"
    >
      {/* Plain white like the Conversations header, so the rows scrolling under it do not show through. */}
      <div ref={headerRef} className="sticky top-0 z-10 border-b bg-background p-3">
        {/* The same 40px title row as the Conversations header, level with the rail's logo, with the date on the right. */}
        <div className="flex h-10 items-center justify-between gap-3">
          <h1 className="shrink-0 text-xl font-medium">Summary</h1>
          <div className="flex min-w-0 items-center gap-1">
            <time dateTime={today} className="min-w-0 truncate pr-2 text-sm text-muted-foreground">{dayDate(now.toISOString())}</time>
            <BriefPlayer />
            <SummaryFilter filter={filter} options={options} openId={params.id} />
          </div>
        </div>
        {/* Checked rows bring the selection bar, then the 40px search, level with the rail's Search as in Conversations. */}
        {picked.length > 0 && (
          <div className="mt-3 flex h-10 flex-col justify-center">
            <SelectionBar
              allPicked={picked.length === order.length}
              anyUnread={threads.some((t) => t.unread && pickedIds.has(t.id))}
              ids={picked}
              onAll={() => setChecked(order)}
              onClear={() => setChecked([])}
              onAction={(action) => (action === "snooze" ? snoozePick.request(picked) : run(picked, action))}
            />
          </div>
        )}
        <SearchBand value={search} onChange={setSearch} placeholder="Search Summary" className={picked.length > 0 ? "mt-1 border-b-0 p-0" : "mt-3 border-b-0 p-0"} inputClassName="h-10" />
      </div>
      <div ref={rowsRef} className="px-3">
        {busy && <LoadingSummary />}
        {!busy && stalled > 0 && <AccountsNotice count={stalled} />}
        {!busy && empty && term && <div className="py-24"><EmptyState icon={SearchX} title="No Matches" description="Nothing on the Summary matches your search." /></div>}
        {!busy && empty && !term && <SummaryEmpty noAccounts={noAccounts} importing={importing} filter={filter} onClearFilter={() => router.replace(listHref("none", params.id))} />}
        {!busy && !empty && (
          <div>
            {calendarShown && (
              <Section title="Today's Calendar" count={calendarFailed || calendarPending ? undefined : events.length} headerHeight={headerHeight} action={{ label: "Open", href: "/calendar" }} separated>
                <CalendarBody failed={calendarFailed} pending={calendarPending} events={events} today={today} onRetry={retryCalendar} />
              </Section>
            )}
            {todaysTasks.length > 0 && (
              <Section title="Tasks" count={todaysTasks.length} headerHeight={headerHeight} action={{ label: "Open", href: "/calendar" }} separated={!calendarShown}>
                <Separated>{todaysTasks.map((t) => <TaskRow key={t.task.id} item={t} today={today} source={sourceOf(t.task.accountId)} />)}</Separated>
              </Section>
            )}
            <PromisesSection headerHeight={headerHeight} now={sectionsNow} base={BASE} />
            {sections.reply.length > 0 && <Section title="Needs Reply" count={sections.reply.length} headerHeight={headerHeight} separated={!calendarShown && todaysTasks.length === 0}>{rows(sections.reply)}</Section>}
            {sections.priority.length > 0 && <Section title="Important" count={sections.priority.length} headerHeight={headerHeight}>{rows(sections.priority)}</Section>}
            {sections.updates.length > 0 && <Section title="Updates" count={sections.updates.length} headerHeight={headerHeight}>{rows(sections.updates)}</Section>}
            {sections.waiting.length > 0 && <Section title="Waiting On Others" count={sections.waiting.length} headerHeight={headerHeight} separated={!calendarShown && todaysTasks.length === 0}>{rows(sections.waiting)}</Section>}
            {older.length > 0 && (
              <Section title="Older" count={older.length} headerHeight={headerHeight} separated={!calendarShown && todaysTasks.length === 0 && sections.reply.length + sections.priority.length + sections.updates.length === 0}>
                {rows(olderShown)}
                {older.length > OLDER_SHOWN && (
                  <Button type="button" variant="ghost" className="mt-2 h-10 w-full" onClick={() => setAllOlder((a) => !a)}>{allOlder ? "Show Fewer" : "Show All"}</Button>
                )}
              </Section>
            )}
          </div>
        )}
      </div>
      {snoozePick.dialog}
      <ManageLabelsHost />
    </ScrollArea>
  );
}