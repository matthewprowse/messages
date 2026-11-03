"use client";

// The Inbox conversation list: header, search, rows (or Subscriptions senders) and infinite scrolling. The parts live in
// components/thread-list/; this file wires them together and re-exports what the Summary list and Notes reuse.

import { Fragment, useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { Inbox as InboxIcon, Mail, MailX, RefreshCw } from "lucide-react";
import { useApp } from "@/lib/store";
import type { Thread } from "@/lib/types";
import { PaneHeader, SearchBand } from "@/components/pane";
import { nextLimit, PAGE_SIZE } from "@/lib/selection";
import { accountNameMap, emptyFor, matchesSearch } from "@/lib/thread-list";
import { parseQuery, plainText } from "@/lib/search/query";
import { useIndexThreadIds } from "@/lib/search/use-search";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { EmptyState } from "@/components/primitives";
import { useImporting } from "@/components/sync-bar";
import { TeamInbox } from "@/components/team-inbox";
import { LabelChips } from "@/components/labels/label-chips";
import { ManageLabelsHost } from "@/components/labels/manage-labels-dialog";
import { useSnoozePick } from "@/components/snooze/use-snooze-pick";
import { DeletedList } from "@/components/thread-list/deleted-list";
import { FilterButton, ListControls } from "@/components/thread-list/list-controls";
import { LoadingRows } from "@/components/thread-list/loading-rows";
import { RowButton } from "@/components/thread-list/row-button";
import { BulkBar, SelectionBar } from "@/components/thread-list/selection-bar";
import { SubscriptionRow } from "@/components/thread-list/subscription-row";
import { ThreadRow } from "@/components/thread-list/thread-row";
import { PersonList } from "@/components/person/person-list";
import { useInboxKeys } from "@/components/thread-list/use-inbox-keys";
import { useListState } from "@/components/thread-list/use-list-state";
import { useRowActions } from "@/components/thread-list/use-row-actions";
import { useSwipedRow, useToday } from "@/components/thread-list/use-row-state";
import { CleanUpLink } from "@/components/clean-up/clean-up-link";
import { useSubscriptions } from "@/components/thread-list/use-subscriptions";
import { useThreadSelection } from "@/components/thread-list/use-thread-selection";

export { SelectionBar, ThreadRow, useRowActions, useSwipedRow, useThreadSelection, useToday };
export type { RowAction } from "@/components/thread-list/use-row-actions";

const NO_THREADS: Thread[] = [];

export function ThreadList() {
  const { view, filter, label, byPerson, query } = useListState();
  const params = useParams<{ id?: string }>();
  const { listThreads, accounts, loading, contactById: contactOf, prefetchMessages, labels: labelApi } = useApp();
  const noAccounts = !accounts.some((a) => a.status !== "disconnected");
  // A name beside the logo only tells accounts apart, so it shows once there are two of one service.
  const accountNames = useMemo(() => accountNameMap(accounts), [accounts]);
  const importing = useImporting().length > 0;
  const [search, setSearch] = useState("");
  // Deferred, so typing stays smooth while 1,000 conversations are filtered.
  const term = useDeferredValue(search.trim().toLowerCase());
  const withLabel = useMemo(() => (label ? labelApi.threadsWith(label) : undefined), [label, labelApi]);
  // The same engine as the Cmd-K palette: the private index also searches message text, files and operators (from:, has:attachment,
  // is:unread, before:, after:). Only conversations loaded into the list can be shown here; older ones are reached from the palette.
  const parsed = useMemo(() => parseQuery(term), [term]);
  const indexed = useIndexThreadIds(term);
  // Already sorted with pinned conversations first. Until the index answers, search matches the row's name, subject and preview.
  const threads = useMemo(() => {
    let all = listThreads(view, filter);
    if (withLabel) all = all.filter((t) => withLabel.has(t.id));
    if (!term) return all;
    const plain = plainText(parsed);
    const quick = (t: Thread) => !plain || matchesSearch(t, plain, (x) => contactOf(x.participantIds[0])?.name);
    // An operator is only understood by the index, so without it the words alone narrow the list.
    return all.filter((t) => (indexed ? indexed.has(t.id) || (!parsed.hasOperators && quick(t)) : quick(t)));
  }, [listThreads, view, filter, withLabel, term, parsed, indexed, contactOf]);
  const order = useMemo(() => threads.map((t) => t.id), [threads]);
  // Snooze with no time (H, the row button, the bulk bar) opens the choices; the dialog needs run, which comes from the selection.
  const askRef = useRef<(ids: string[]) => void>(() => undefined);
  const { picked, setChecked, check, run, onRowAction } = useThreadSelection(order, query, `${view}:${filter}:${label ?? ""}`, "/inbox", true, (ids) => askRef.current(ids));
  const snoozePick = useSnoozePick(run);
  askRef.current = (ids) => snoozePick.request(ids);
  // Rows are memoised, so this reads the latest picked and the snooze helpers through a ref and never changes.
  const snoozeLatest = useRef({ picked, snoozePick });
  snoozeLatest.current = { picked, snoozePick };
  const onSnooze = useCallback((id: string, mode: "snooze" | "remind", at: Date | "pick") => {
    const { picked, snoozePick } = snoozeLatest.current;
    const ids = picked.includes(id) ? picked : [id];
    if (at === "pick") snoozePick.request(ids, mode, "date"); else snoozePick.snoozeAt(ids, at, mode);
  }, []);
  useInboxKeys({ order, query, picked, setChecked, run });
  const subs = useSubscriptions(view === "subscriptions" ? threads : NO_THREADS, contactOf, `${view}:${filter}:${term}`);
  const subsPicked = useMemo(() => new Set(subs.picked), [subs.picked]);
  const subsPickable = useMemo(() => new Set(subs.pickable), [subs.pickable]);
  const pickedSet = useMemo(() => new Set(picked), [picked]);
  const today = useToday();
  const rowSwipe = useSwipedRow();

  // Select mode lets touch users check rows without a modifier key. Rows act as if some are checked.
  const [selectMode, setSelectMode] = useState(false);
  const selectingRows = selectMode || picked.length > 0;
  const selectingSubs = selectMode || subs.picked.length > 0;
  const endSelecting = () => { setSelectMode(false); setChecked([]); subs.setChecked([]); };
  // Long lists draw a hundred rows, then a hundred more whenever the end nears the viewport. The limit
  // starts over when the list changes. Keyboard navigation reads whatever rows are drawn.
  const listKey = `${view}:${filter}:${term}`;
  const [limit, setLimit] = useState({ key: listKey, n: PAGE_SIZE });
  const shown = limit.key === listKey ? limit.n : PAGE_SIZE;
  const total = view === "subscriptions" ? subs.senders.length : threads.length;
  const sentinel = useRef<HTMLDivElement>(null);
  const more = shown < total;
  useEffect(() => {
    const el = sentinel.current;
    if (!el || !more) return;
    const observer = new IntersectionObserver(
      (entries) => { if (entries.some((e) => e.isIntersecting)) setLimit({ key: listKey, n: nextLimit(shown, total) }); },
      { root: el.closest<HTMLElement>("[data-slot=scroll-area-viewport]"), rootMargin: "600px" },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [more, shown, total, listKey]);

  return (
    // The header sits above the scroll area, so the rows and their scrollbar both start below it.
    <div className="flex h-full min-h-0 flex-col">
      <div className="shrink-0">
        <PaneHeader
          title="Conversations"
          action={
            <>
              <FilterButton view={view} filter={filter} label={label} byPerson={byPerson} />
              <Button variant={selectMode ? "secondary" : "ghost"} aria-pressed={selectMode} onClick={() => (selectMode ? endSelecting() : setSelectMode(true))}>
                {selectMode ? "Done" : "Select"}
              </Button>
            </>
          }
        >
          {/* The views (or the selection's actions) and the search, 40px each with 4px between, level with the rail's items. */}
          <div className="flex flex-col gap-1">
            <div className="flex h-10 flex-col justify-center">
            {view === "subscriptions" && selectingSubs ? (
              <BulkBar allPicked={subs.pickable.length > 0 && subs.picked.length === subs.pickable.length} onAll={() => subs.setChecked(subs.pickable)} onClear={() => subs.setChecked([])} onDone={endSelecting}>
                <RowButton label="Unsubscribe" icon={MailX} onClick={() => subs.run(subs.picked)} />
              </BulkBar>
            ) : selectingRows && view !== "subscriptions" ? (
              <SelectionBar
                allPicked={order.length > 0 && picked.length === order.length}
                ids={picked}
                count={picked.length}
                anyUnread={threads.some((t) => t.unread && pickedSet.has(t.id))}
                onAll={() => setChecked(order)}
                onClear={() => setChecked([])}
                onDone={endSelecting}
                onAction={(action) => run(picked, action)}
              />
            ) : (
              <ListControls view={view} filter={filter} label={label} byPerson={byPerson} />
            )}
            </div>
            <SearchBand value={search} onChange={setSearch} placeholder="Search Conversations" className="border-b-0 p-0" inputClassName="h-10" />
          </div>
          {!selectingRows && !selectingSubs && <LabelChips view={view} filter={filter} label={label} />}
        </PaneHeader>
        {view === "subscriptions" && <CleanUpLink />}
      </div>
      <ScrollArea className="min-h-0 flex-1">
        <div className="p-3">
          <TeamInbox query={query} hidden={view !== "all" || !!term} />
          {loading && <LoadingRows />}
          {view === "deleted" && <DeletedList term={term} />}
          {!loading && view !== "deleted" && threads.length === 0 && (
            <div className="py-24">
              {noAccounts ? (
                <EmptyState
                  icon={Mail}
                  title="Connect an Account"
                  description="Link Gmail, iCloud or WhatsApp to see your conversations here."
                  action={<Button asChild><Link href="/settings/accounts">Connect an Account</Link></Button>}
                />
              ) : term ? (
                <EmptyState icon={InboxIcon} title="No Matches" description="No conversations match your search." />
              ) : withLabel ? (
                <EmptyState icon={InboxIcon} title="Nothing With This Label" description="Label a conversation from its menu to see it here." />
              ) : importing ? (
                <EmptyState icon={RefreshCw} title="Importing Your Messages" description="Conversations appear here as they arrive. The first import can take a few minutes." />
              ) : (
                <EmptyState icon={InboxIcon} title={emptyFor(view, filter).title} description={emptyFor(view, filter).description} />
              )}
            </div>
          )}
          {view === "deleted" ? null : view === "subscriptions" ? (
            <div className="flex flex-col gap-2">
              {subs.senders.slice(0, shown).map((s, i) => (
                <Fragment key={s.key}>
                  {i > 0 && <div className="pl-16"><Separator /></div>}
                  <SubscriptionRow
                  sender={s}
                  statuses={s.addresses.map((a) => subs.statusByKey.get(a.key))}
                  query={query}
                  open={params.id === s.latest.id}
                  checked={subsPicked.has(s.key)}
                  selecting={selectingSubs}
                  pickable={subsPickable.has(s.key)}
                  onCheck={subs.check}
                  onUnsubscribe={(key) => subs.run([key])}
                  onConfirm={subs.confirm}
                  />
                </Fragment>
              ))}
            </div>
          ) : byPerson ? (
            <PersonList threads={threads} query={query} limit={shown} />
          ) : (
            <div className="flex flex-col gap-2">
              {threads.slice(0, shown).map((t, i) => (
                <Fragment key={t.id}>
                  {i > 0 && <div className="pl-16"><Separator /></div>}
                  <ThreadRow
                  thread={t}
                  today={today}
                  contact={t.isGroup ? undefined : contactOf(t.participantIds[0])}
                  query={query}
                  selected={params.id === t.id}
                  checked={pickedSet.has(t.id)}
                  selecting={selectingRows}
                  onCheck={check}
                  onAction={onRowAction}
                  onPress={prefetchMessages}
                  swiped={rowSwipe.swiped === t.id}
                  onSwipe={rowSwipe.onSwipe}
                  onTouchRow={rowSwipe.onTouchRow}
                  lastSender={t.isGroup && t.lastSenderId ? contactOf(t.lastSenderId) : undefined}
                  accountName={t.accountId ? accountNames.get(t.accountId) : undefined}
                  onSnooze={onSnooze}
                  labels={labelApi.labelsOf(t.id)}
                  pickedIds={pickedSet.has(t.id) ? picked : undefined}
                  />
                </Fragment>
              ))}
            </div>
          )}
          {more && <div ref={sentinel} aria-hidden className="h-px" />}
        </div>
      </ScrollArea>
      {snoozePick.dialog}
      <ManageLabelsHost />
    </div>
  );
}