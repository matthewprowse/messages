"use client";

// The Inbox conversation list: header, search, rows (or Subscriptions senders) and infinite scrolling. The parts live in
// components/thread-list/; this file wires them together and re-exports what the Summary list and Notes reuse.

import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { Inbox as InboxIcon, Mail, MailX, RefreshCw } from "lucide-react";
import { useApp } from "@/lib/store";
import type { Thread } from "@/lib/types";
import { PaneHeader, SearchBand } from "@/components/pane";
import { nextLimit, PAGE_SIZE } from "@/lib/selection";
import { accountNameMap, EMPTY, matchesSearch } from "@/lib/thread-list";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/primitives";
import { useImporting } from "@/components/sync-bar";
import { TeamInbox } from "@/components/team-inbox";
import { ListControls } from "@/components/thread-list/list-controls";
import { LoadingRows } from "@/components/thread-list/loading-rows";
import { RowButton } from "@/components/thread-list/row-button";
import { BulkBar, SelectionBar } from "@/components/thread-list/selection-bar";
import { SubscriptionRow } from "@/components/thread-list/subscription-row";
import { ThreadRow } from "@/components/thread-list/thread-row";
import { useListState } from "@/components/thread-list/use-list-state";
import { useRowActions } from "@/components/thread-list/use-row-actions";
import { useSwipedRow, useToday } from "@/components/thread-list/use-row-state";
import { useSubscriptions } from "@/components/thread-list/use-subscriptions";
import { useThreadSelection } from "@/components/thread-list/use-thread-selection";

export { SelectionBar, ThreadRow, useRowActions, useSwipedRow, useThreadSelection, useToday };
export type { RowAction } from "@/components/thread-list/use-row-actions";

const NO_THREADS: Thread[] = [];

export function ThreadList() {
  const { view, filter, query } = useListState();
  const params = useParams<{ id?: string }>();
  const { listThreads, accounts, loading, contactById: contactOf, prefetchMessages } = useApp();
  const noAccounts = !accounts.some((a) => a.status !== "disconnected");
  // A name beside the logo only tells accounts apart, so it shows once there are two of one service.
  const accountNames = useMemo(() => accountNameMap(accounts), [accounts]);
  const importing = useImporting().length > 0;
  const [search, setSearch] = useState("");
  const term = search.trim().toLowerCase();
  // Already sorted with pinned conversations first. Search matches the row's name, subject and preview.
  const threads = useMemo(() => {
    const all = listThreads(view, filter);
    if (!term) return all;
    return all.filter((t) => matchesSearch(t, term, (x) => contactOf(x.participantIds[0])?.name));
  }, [listThreads, view, filter, term, contactOf]);
  const order = useMemo(() => threads.map((t) => t.id), [threads]);
  const { picked, setChecked, check, run, onRowAction } = useThreadSelection(order, query, `${view}:${filter}`);
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
          title="Inbox"
          action={
            <Button variant={selectMode ? "secondary" : "ghost"} aria-pressed={selectMode} onClick={() => (selectMode ? endSelecting() : setSelectMode(true))}>
              {selectMode ? "Done" : "Select"}
            </Button>
          }
        >
          {view === "subscriptions" && selectingSubs ? (
          <BulkBar allPicked={subs.pickable.length > 0 && subs.picked.length === subs.pickable.length} onAll={() => subs.setChecked(subs.pickable)} onClear={() => subs.setChecked([])} onDone={endSelecting}>
            <RowButton label="Unsubscribe" icon={MailX} onClick={() => subs.run(subs.picked)} />
          </BulkBar>
        ) : selectingRows && view !== "subscriptions" ? (
          <SelectionBar
            allPicked={order.length > 0 && picked.length === order.length}
            anyUnread={threads.some((t) => t.unread && pickedSet.has(t.id))}
            onAll={() => setChecked(order)}
            onClear={() => setChecked([])}
            onDone={endSelecting}
            onAction={(action) => run(picked, action)}
          />
        ) : (
          <ListControls view={view} filter={filter} />
        )}
        </PaneHeader>
        <SearchBand value={search} onChange={setSearch} placeholder="Search Conversations" />
      </div>
      <ScrollArea className="min-h-0 flex-1">
        <div className="p-3">
          <TeamInbox query={query} hidden={view !== "all" || !!term} />
          {loading && <LoadingRows />}
          {!loading && threads.length === 0 && (
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
              ) : importing ? (
                <EmptyState icon={RefreshCw} title="Importing Your Messages" description="Conversations appear here as they arrive. The first import can take a few minutes." />
              ) : (
                <EmptyState icon={InboxIcon} title={EMPTY[view].title} description={EMPTY[view].description} />
              )}
            </div>
          )}
          {view === "subscriptions" ? (
            <div className="flex flex-col gap-2">
              {subs.senders.slice(0, shown).map((s, i) => (
                <Fragment key={s.key}>
                  {i > 0 && <div className="pl-14"><Separator /></div>}
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
          ) : (
            <div className="flex flex-col gap-2">
              {threads.slice(0, shown).map((t, i) => (
                <Fragment key={t.id}>
                  {i > 0 && <div className="pl-14"><Separator /></div>}
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
                  />
                </Fragment>
              ))}
            </div>
          )}
          {more && <div ref={sentinel} aria-hidden className="h-px" />}
        </div>
      </ScrollArea>
    </div>
  );
}