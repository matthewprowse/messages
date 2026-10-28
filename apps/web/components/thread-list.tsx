"use client";

// The Inbox conversation list: rows with hover and swipe actions, selection and its bar, and ThreadRow, which the Summary list reuses.

import { Fragment, memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { track } from "@/lib/analytics";
import Link from "next/link";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { Archive, Check, ExternalLink, Inbox as InboxIcon, Mail, MailCheck, MailX, OctagonAlert, Pin, RefreshCw, Trash2, X, type LucideIcon } from "lucide-react";
import { useApp } from "@/lib/store";
import type { Contact, ListFilter, Thread, Unsubscribe, View } from "@/lib/types";
import { niceName, relTime } from "@/lib/format";
import { PaneControls, PaneHeader, PaneSelect, SearchBand, ViewButtons } from "@/components/pane";
import { filtersForView, nextLimit, PAGE_SIZE, toggleSelection, type ShortcutAction } from "@/lib/selection";
import { cn } from "@/lib/utils";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuSeparator, ContextMenuShortcut, ContextMenuTrigger } from "@/components/ui/context-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { CompanyAvatar, ContactAvatar, EmptyState, GroupAvatar } from "@/components/primitives";
import { useImporting } from "@/components/sync-bar";
import { ProviderLogo } from "@/components/provider-logo";
import { WorkTag } from "@/components/work-badge";
import { TeamInbox } from "@/components/team-inbox";

const VIEWS: { key: View; label: string }[] = [
  { key: "all", label: "All" },
  { key: "priority", label: "Priority" },
  { key: "junk", label: "Junk" },
  { key: "subscriptions", label: "Subscriptions" },
];

const FILTER_OPTIONS: { key: ListFilter; label: string }[] = [
  { key: "none", label: "No Filter" },
  { key: "unread", label: "Unread" },
  { key: "email", label: "Email" },
  { key: "whatsapp", label: "WhatsApp" },
  { key: "waiting", label: "Waiting" },
];

const EMPTY: Record<View, { title: string; description: string }> = {
  all: { title: "You're All Caught Up", description: "New messages appear within seconds of arriving." },
  priority: { title: "Nothing Needs You Right Now", description: "Urgent and important conversations appear here." },
  junk: { title: "No Junk", description: "Spam and cold outreach the AI sorts out lands here." },
  subscriptions: { title: "No Subscriptions", description: "Newsletters, promotions and alerts you can unsubscribe from land here." },
};

function withQuery(path: string, query: string) {
  return query ? `${path}?${query}` : path;
}

function listHref(view: View, filter: ListFilter) {
  const p = new URLSearchParams();
  if (view !== "all") p.set("view", view);
  // A filter that does not apply to the view (WhatsApp in Subscriptions) is left out of its link.
  if (filter !== "none" && filtersForView(view).includes(filter)) p.set("filter", filter);
  return withQuery("/inbox", p.toString());
}

function filterOf(raw: string | null): ListFilter {
  return raw && FILTER_OPTIONS.some((o) => o.key === raw) ? (raw as ListFilter) : "none";
}

function useListState() {
  const params = useSearchParams();
  const viewParam = params.get("view");
  const view: View = viewParam === "priority" || viewParam === "junk" || viewParam === "subscriptions" ? viewParam : "all";
  const rawFilter = filterOf(params.get("filter"));
  const filter: ListFilter = filtersForView(view).includes(rawFilter) ? rawFilter : "none";
  // Which view and filter people choose (the default is not a choice).
  useEffect(() => {
    if (view !== "all") track("feature_used", { feature: "conversation_view", detail: view });
  }, [view]);
  useEffect(() => {
    if (filter !== "none") track("feature_used", { feature: "conversation_filter", detail: filter });
  }, [filter]);
  // A message jumped to from search belongs to one conversation, so it is not carried into list links.
  const query = new URLSearchParams(params);
  query.delete("message");
  return { view, filter, query: query.toString() };
}

function ListControls({ view, filter }: { view: View; filter: ListFilter }) {
  const router = useRouter();
  return (
    <PaneControls>
      <ViewButtons label="View" value={view} items={VIEWS} hrefFor={(v) => listHref(v, filter)} />
      <PaneSelect
        label="Filter"
        value={filter === "none" ? "" : filter}
        onChange={(f) => router.replace(listHref(view, f as ListFilter))}
        options={FILTER_OPTIONS.filter((o) => filtersForView(view).includes(o.key)).map((o) => ({ value: o.key, label: o.label }))}
      />
    </PaneControls>
  );
}

export type RowAction = ShortcutAction | "read" | "pin";

/** Carries out a row action on one conversation or a selection. */
export function useRowActions() {
  const { threads: all, archive, trash, setJunk, markRead, pin } = useApp();
  return useCallback((ids: string[], action: RowAction) => {
    const wanted = new Set(ids);
    const threads = all.filter((t) => wanted.has(t.id));
    if (threads.length === 0) return;
    const found = threads.map((t) => t.id);
    if (action === "archive") archive(found);
    else if (action === "trash") trash(found);
    // Junk toggles: conversations that are all junk come out of it, anything else goes in.
    else if (action === "junk") setJunk(found, !threads.every((t) => t.junk));
    else if (action === "read") {
      // Marks them read if any is unread, otherwise unread.
      const read = threads.some((t) => t.unread);
      for (const t of threads) if (t.unread === read) markRead(t.id, read);
    } else {
      const pinned = !threads.every((t) => t.pinned);
      for (const t of threads) if (t.pinned !== pinned) pin(t.id, pinned);
    }
  }, [all, archive, trash, setJunk, markRead, pin]);
}

function RowButton({ label, icon: Icon, onClick, variant = "ghost", className }: { label: string; icon: LucideIcon; onClick: () => void; variant?: "ghost" | "secondary"; className?: string }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button variant={variant} size="icon" aria-label={label} onClick={onClick} className={className}><Icon /></Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

// On hover a row's content fades out over the 32px before its action buttons and is gone beneath them.
// Each button is 32px with 4px between, 12px from the right edge. Keyed by the number of buttons.
const FADE: Record<1 | 2 | 3, string> = {
  1: "group-hover/row:[mask-image:linear-gradient(to_right,black_calc(100%-76px),transparent_calc(100%-44px))] [&_[data-hover-hide]]:group-hover/row:invisible group-focus-within/row:[mask-image:linear-gradient(to_right,black_calc(100%-76px),transparent_calc(100%-44px))] pointer-coarse:[mask-image:linear-gradient(to_right,black_calc(100%-76px),transparent_calc(100%-44px))] [&_[data-hover-hide]]:group-focus-within/row:invisible [&_[data-hover-hide]]:pointer-coarse:invisible",
  2: "group-hover/row:[mask-image:linear-gradient(to_right,black_calc(100%-112px),transparent_calc(100%-80px))] [&_[data-hover-hide]]:group-hover/row:invisible group-focus-within/row:[mask-image:linear-gradient(to_right,black_calc(100%-112px),transparent_calc(100%-80px))] pointer-coarse:[mask-image:linear-gradient(to_right,black_calc(100%-112px),transparent_calc(100%-80px))] [&_[data-hover-hide]]:group-focus-within/row:invisible [&_[data-hover-hide]]:pointer-coarse:invisible",
  3: "group-hover/row:[mask-image:linear-gradient(to_right,black_calc(100%-148px),transparent_calc(100%-116px))] [&_[data-hover-hide]]:group-hover/row:invisible group-focus-within/row:[mask-image:linear-gradient(to_right,black_calc(100%-148px),transparent_calc(100%-116px))] pointer-coarse:[mask-image:linear-gradient(to_right,black_calc(100%-148px),transparent_calc(100%-116px))] [&_[data-hover-hide]]:group-focus-within/row:invisible [&_[data-hover-hide]]:pointer-coarse:invisible",
};

// Conversation rows (here and on Summary) fade for their actions only with a mouse, or on a phone once
// swiped: a phone shows the photo, the time and the unread count, and a swipe to the left brings the
// actions and the checkbox out. Focus fades a row only with a mouse, as a tap focuses the row it opens.
const ROW_FADE =
  "group-hover/row:[mask-image:linear-gradient(to_right,black_calc(100%-148px),transparent_calc(100%-116px))] [&_[data-hover-hide]]:group-hover/row:invisible pointer-fine:group-focus-within/row:[mask-image:linear-gradient(to_right,black_calc(100%-148px),transparent_calc(100%-116px))] [&_[data-hover-hide]]:pointer-fine:group-focus-within/row:invisible";
const SWIPED_FADE = "[mask-image:linear-gradient(to_right,black_calc(100%-148px),transparent_calc(100%-116px))] [&_[data-hover-hide]]:invisible";
/** How far a finger moves sideways, and more sideways than down, before it counts as a swipe. */
const SWIPE_PX = 32;

/** Which row is swiped open on a touch screen: one at a time, closed by touching another row. */
export function useSwipedRow() {
  const [swiped, setSwiped] = useState<string | null>(null);
  const onSwipe = useCallback((id: string | null) => setSwiped(id), []);
  const onTouchRow = useCallback((id: string) => setSwiped((s) => (s === id ? s : null)), []);
  return { swiped, onSwipe, onTouchRow };
}

// A row's hover actions, in order from the left.
const ROW_ACTIONS = (thread: Thread): { action: RowAction; label: string; icon: LucideIcon }[] => [
  { action: "archive", label: "Archive", icon: Archive },
  { action: "trash", label: "Delete", icon: Trash2 },
  { action: "junk", label: thread.junk ? "Not Junk" : "Move to Junk", icon: thread.junk ? MailCheck : OctagonAlert },
];

/** Today's date, changing at midnight, so memoised rows redraw their times ("Yesterday") as days pass. */
export function useToday() {
  const [today, setToday] = useState(() => new Date().toDateString());
  useEffect(() => {
    const now = new Date();
    const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1).getTime() - now.getTime();
    const t = setTimeout(() => setToday(new Date().toDateString()), midnight + 1000);
    return () => clearTimeout(t);
  }, [today]);
  return today;
}

// Memoised with id-based callbacks, so opening or checking one row re-renders only the rows that change.
// Exported for the Summary page, which links rows to /summary and shows each conversation's AI summary.
export const ThreadRow = memo(function ThreadRow({
  thread,
  contact,
  query,
  selected,
  checked,
  selecting,
  onCheck,
  onAction,
  onPress,
  baseHref = "/inbox",
  summary,
  accountName,
  lastSender,
  swiped = false,
  onSwipe,
  onTouchRow,
}: {
  thread: Thread;
  /** Only read through relTime: a new day redraws the row. */
  today: string;
  /** The other person in a one-to-one conversation. */
  contact?: Contact;
  query: string;
  selected: boolean;
  checked: boolean;
  /** Some rows are checked, so a click on any row checks it instead of opening it. */
  selecting: boolean;
  onCheck: (id: string, range: boolean) => void;
  onAction: (id: string, action: RowAction) => void;
  /** Called on pointer down, so the conversation's messages start loading before the click lands. */
  onPress: (id: string) => void;
  /** Where the row links: /inbox by default, /summary on the Summary page. */
  baseHref?: string;
  /** An extra line under the preview, such as the AI summary. */
  summary?: string;
  /** The account's name, given only when the person has several accounts of this service. */
  accountName?: string;
  /** Who sent the latest message of a group, named before its preview. */
  lastSender?: Contact;
  /** Swiped open on a touch screen: the actions and the checkbox are out. */
  swiped?: boolean;
  /** A swipe to the left opens this row (id), to the right closes it (null). */
  onSwipe?: (id: string | null) => void;
  /** A finger came down on this row, which closes any other row left open. */
  onTouchRow?: (id: string) => void;
}) {
  const router = useRouter();
  const title = niceName((thread.isGroup ? thread.groupName : contact?.name ?? thread.fallbackName) ?? "Unknown");
  // Email rows show the subject, chats show the latest message.
  const body = (thread.channel === "email" ? thread.subject : undefined) ?? thread.preview ?? "";
  // A group says who spoke last, the way Messages does.
  // WhatsApp groups already store the speaker in the preview ("Kelly Prowse: ..."), so it is only added where it is missing.
  const speaker = thread.isGroup && !/^[^\n:]{1,50}: /.test(body) ? (thread.lastFromMe ? "You" : lastSender && niceName(lastSender.name).split(" ")[0]) : undefined;
  const preview = speaker && body ? `${speaker}: ${body}` : body;
  const href = withQuery(`${baseHref}/${thread.id}`, query);
  const unreadCount = thread.unreadCount;
  const lit = selected || checked;
  // Viewport prefetching would fetch every row, so a row is fetched once the pointer or focus reaches it.
  const prefetch = () => router.prefetch(href);
  const act = (action: RowAction) => onAction(thread.id, action);
  const open = swiped && !selecting;

  // A swipe is a sideways move, clearly more sideways than down, so scrolling the list is never one.
  const touch = useRef<{ x: number; y: number; done: boolean } | null>(null);
  const swipedAt = useRef(0);
  const swipe = onSwipe && {
    onTouchStart: (e: React.TouchEvent) => {
      const t = e.touches[0];
      touch.current = { x: t.clientX, y: t.clientY, done: false };
      onTouchRow?.(thread.id);
    },
    onTouchMove: (e: React.TouchEvent) => {
      const start = touch.current;
      if (!start || start.done || selecting) return;
      const t = e.touches[0];
      const dx = t.clientX - start.x;
      if (Math.abs(dx) < SWIPE_PX || Math.abs(dx) < Math.abs(t.clientY - start.y) * 1.5) return;
      start.done = true;
      swipedAt.current = Date.now();
      onSwipe(dx < 0 ? thread.id : null);
    },
    onTouchEnd: () => { touch.current = null; },
  };

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div data-thread-row={thread.id} {...swipe} className={cn("group/row relative touch-pan-y rounded-lg", lit ? "bg-muted [&_[data-unread]]:bg-background" : "hover:bg-muted/50")}>
          <Link
            href={href}
            prefetch={false}
            data-row-link
            aria-current={selected ? "page" : undefined}
            onMouseEnter={prefetch}
            onFocus={prefetch}
            onPointerDown={() => onPress(thread.id)}
            // Cmd or Ctrl-click checks one row, Shift-click a range. Once any are checked, a click checks too.
            onClick={(e) => {
              // The end of a swipe is not a tap, and a tap on a row swiped open closes it.
              if (Date.now() - swipedAt.current < 400) { e.preventDefault(); return; }
              if (open) { e.preventDefault(); onSwipe?.(null); return; }
              if (!(e.shiftKey || e.metaKey || e.ctrlKey || selecting)) return;
              e.preventDefault();
              onCheck(thread.id, e.shiftKey);
            }}
            // While rows are checked the header has the actions, so rows show none and nothing fades.
            className={cn("flex items-center gap-3 rounded-lg p-3 outline-none focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:ring-inset", !selecting && (open ? SWIPED_FADE : ROW_FADE))}
          >
            <div className={cn("shrink-0", lit && "[&_[data-slot=avatar-fallback]]:bg-background", selecting || open ? "invisible" : "group-hover/row:invisible group-has-focus-visible/row:invisible pointer-fine:group-focus-within/row:invisible")}>
              {/* A group's own picture, or the other person's photo. */}
              {thread.isGroup ? <GroupAvatar path={thread.avatarPath} className="size-8" /> : <ContactAvatar contact={contact} className="size-8" />}
            </div>
            {/* 20px name line + 4px gap + 16px preview line. */}
            <div className="flex min-w-0 flex-1 flex-col gap-1">
              <div className="flex h-5 items-center justify-between gap-3">
                <span className="flex min-w-0 items-center gap-1.5">
                  <span className="min-w-0 truncate text-sm font-medium">{title}</span>
                  <ProviderLogo provider={thread.provider} />
                  {accountName && <span className="min-w-0 shrink-[2] truncate text-xs text-muted-foreground">{accountName}</span>}
                  <WorkTag thread={thread} />
                  {thread.pinned && <Pin className="size-3 shrink-0 text-muted-foreground" aria-label="Pinned" />}
                </span>
                <span data-hover-hide className="shrink-0 text-xs tabular-nums text-muted-foreground">{relTime(thread.lastMessageAt)}</span>
              </div>
              <div className="flex h-4 items-center justify-between gap-3">
                {/* Always full colour: unread shows in the count. Only the AI summary below is muted. */}
                <span className="min-w-0 truncate text-xs text-foreground">{preview}</span>
                {unreadCount > 0 && (
                  <span data-unread className="-my-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-medium" data-hover-hide aria-label={`${unreadCount} unread`}>
                    {unreadCount}
                  </span>
                )}
              </div>
              {summary && <p className="line-clamp-2 text-xs text-muted-foreground">{summary}</p>}
            </div>
          </Link>
          {/* Over the avatar: shown on hover or when swiped open, and on every row once one is checked. */}
          <div className={cn("absolute top-1/2 left-3 size-8 -translate-y-1/2 items-center justify-center", selecting || open ? "flex" : "hidden group-hover/row:flex group-has-focus-visible/row:flex pointer-fine:group-focus-within/row:flex")}>
            <Checkbox
              checked={checked}
              aria-label={`Select ${title}`}
              onClick={(e) => {
                e.preventDefault();
                onCheck(thread.id, e.shiftKey);
                onSwipe?.(null); // checking starts selecting: every row shows its checkbox instead
              }}
            />
          </div>
          {/* Shown on hover, or slid out by a swipe, over the faded content. */}
          {!selecting && (
            <div className={cn("absolute top-1/2 right-3 -translate-y-1/2 items-center gap-1", open ? "flex animate-in fade-in-0 slide-in-from-right-4 duration-150" : "hidden group-hover/row:flex pointer-fine:group-focus-within/row:flex")}>
              {ROW_ACTIONS(thread).map((a) => (
                <RowButton
                  key={a.action}
                  variant="secondary"
                  label={a.label}
                  icon={a.icon}
                  onClick={() => act(a.action)}
                />
              ))}
            </div>
          )}
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent className="w-48">
        <ContextMenuItem onSelect={() => onCheck(thread.id, false)}>{checked ? "Deselect" : "Select"}</ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem onSelect={() => act("archive")}>Archive<ContextMenuShortcut>E</ContextMenuShortcut></ContextMenuItem>
        <ContextMenuItem onSelect={() => act("trash")}>Delete<ContextMenuShortcut>#</ContextMenuShortcut></ContextMenuItem>
        <ContextMenuItem onSelect={() => act("junk")}>{thread.junk ? "Not Junk" : "Move to Junk"}<ContextMenuShortcut>!</ContextMenuShortcut></ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem onSelect={() => act("read")}>{thread.unread ? "Mark as Read" : "Mark as Unread"}</ContextMenuItem>
        <ContextMenuItem onSelect={() => act("pin")}>{thread.pinned ? "Unpin" : "Pin"}</ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
});

/** Takes the place of the view and filter controls while rows are checked: Select All, then the actions. */
function BulkBar({ allPicked, onAll, onClear, onDone, children }: { allPicked: boolean; onAll: () => void; onClear: () => void; /** Leaves select mode; without it the X only unchecks. */ onDone?: () => void; children: React.ReactNode }) {
  return (
    <div className="flex h-8 items-center justify-between gap-3">
      {/* Once every row is checked, the same button clears them all. */}
      <Button variant="secondary" onClick={allPicked ? onClear : onAll}>{allPicked ? "Deselect All" : "Select All"}</Button>
      <div className="flex items-center gap-1">
        {children}
        <RowButton label={onDone ? "Done Selecting" : "Clear Selection"} icon={X} onClick={onDone ?? onClear} />
      </div>
    </div>
  );
}

/** The header's actions on checked conversations. */
export function SelectionBar({ allPicked, anyUnread, onAll, onClear, onDone, onAction }: { allPicked: boolean; anyUnread: boolean; onAll: () => void; onClear: () => void; onDone?: () => void; onAction: (action: RowAction) => void }) {
  return (
    <BulkBar allPicked={allPicked} onAll={onAll} onClear={onClear} onDone={onDone}>
      <RowButton label="Archive" icon={Archive} onClick={() => onAction("archive")} />
      <RowButton label="Delete" icon={Trash2} onClick={() => onAction("trash")} />
      <RowButton label="Move to Junk" icon={OctagonAlert} onClick={() => onAction("junk")} />
      {/* The read action marks them read if any is unread, otherwise unread, so the label follows. */}
      <RowButton label={anyUnread ? "Mark as Read" : "Mark as Unread"} icon={anyUnread ? MailCheck : Mail} onClick={() => onAction("read")} />
    </BulkBar>
  );
}

const UNSUBSCRIBE_LABEL: Record<Unsubscribe["status"], string> = {
  queued: "Unsubscribing",
  working: "Unsubscribing",
  done: "Unsubscribed",
  manual: "Confirm on Their Page",
  failed: "Could Not Unsubscribe",
};

const NO_THREADS: Thread[] = [];

// Senders already unsubscribed, or on their way, cannot be picked again.
const UNPICKABLE = new Set<Unsubscribe["status"]>(["queued", "working", "done"]);

/** One address that sends subscriptions, on the account it sends to. Unsubscribing works one of these at a time. */
interface Address {
  key: string;
  accountId: string;
  address: string;
}

/**
 * One row in Subscriptions: a company, with every address it writes from, as on the Companies tab. A sender
 * with no company (a personal address) is a row of its own.
 */
interface Sender {
  key: string;
  name: string;
  addresses: Address[];
  /** The company, for its logo. */
  company?: { name: string; logoPath?: string };
  contact?: Contact;
  latest: Thread;
  count: number;
}

const canPick = (status?: Unsubscribe) => !status || !UNPICKABLE.has(status.status);

/**
 * A row's state across its addresses: on its way while any is, waiting on you while any is left to confirm,
 * failed while any failed, and unsubscribed once all are. Nothing while some have never been asked.
 */
function rowStatus(statuses: (Unsubscribe | undefined)[]): Unsubscribe | undefined {
  const known = statuses.filter((u): u is Unsubscribe => !!u);
  return known.find((u) => u.status === "queued" || u.status === "working")
    ?? known.find((u) => u.status === "manual")
    ?? known.find((u) => u.status === "failed")
    ?? (known.length === statuses.length ? known[0] : undefined);
}

/**
 * Subscriptions grouped by company, so a whole company (every address it writes from) can be picked and
 * unsubscribed from in one go. The list keeps the checked rows so its header can act on them. The selection
 * clears when `reset` changes.
 */
function useSubscriptions(items: Thread[], contactOf: (id: string) => Contact | undefined, reset: string) {
  const { unsubscribes, unsubscribe, confirmUnsubscribe } = useApp();
  const [checked, setChecked] = useState<string[]>([]);
  const anchor = useRef<string | null>(null);

  const senders = useMemo(() => {
    const byKey = new Map<string, Sender>();
    for (const t of items) {
      const contact = t.isGroup ? undefined : contactOf(t.participantIds[0]);
      const address = contact?.emails[0];
      if (!t.accountId || !address) continue;
      const one = { key: `${t.accountId}:${address}`, accountId: t.accountId, address };
      const org = contact?.organization;
      const key = org ? `company:${org.id}` : one.key;
      const existing = byKey.get(key);
      if (existing) {
        existing.count++;
        if (!existing.addresses.some((a) => a.key === one.key)) existing.addresses.push(one);
        if (t.lastMessageAt > existing.latest.lastMessageAt) {
          existing.latest = t;
          existing.contact = contact;
        }
      } else {
        byKey.set(key, {
          key,
          name: org?.name ?? contact?.name ?? address,
          addresses: [one],
          company: org ? { name: org.name, logoPath: org.logoPath } : undefined,
          contact,
          latest: t,
          count: 1,
        });
      }
    }
    return [...byKey.values()].sort((a, b) => b.latest.lastMessageAt.localeCompare(a.latest.lastMessageAt));
  }, [items, contactOf]);

  // Keyed like an address, so each row finds its addresses' states without scanning.
  const statusByKey = useMemo(() => new Map(unsubscribes.map((u) => [`${u.accountId}:${u.sender}`, u])), [unsubscribes]);
  // A row can be picked while any of its addresses can still be unsubscribed from.
  const pickable = useMemo(
    () => senders.filter((s) => s.addresses.some((a) => canPick(statusByKey.get(a.key)))).map((s) => s.key),
    [senders, statusByKey],
  );
  // A sender that starts unsubscribing drops out of the selection.
  const picked = useMemo(() => { const ok = new Set(pickable); return checked.filter((k) => ok.has(k)); }, [checked, pickable]);

  useEffect(() => { setChecked([]); anchor.current = null; }, [reset]);

  const check = useCallback((key: string, range: boolean) => {
    const from = anchor.current;
    setChecked((c) => toggleSelection(pickable, c, key, from, range));
    anchor.current = key;
  }, [pickable]);

  // Every address in the chosen rows that can still be unsubscribed from.
  const run = useCallback(async (keys: string[]) => {
    const chosen = senders.filter((s) => keys.includes(s.key));
    const addresses = chosen.flatMap((s) => s.addresses.filter((a) => canPick(statusByKey.get(a.key))));
    if (addresses.length === 0) return;
    track("feature_used", { feature: "unsubscribe", detail: chosen.length > 1 ? "many" : "one" });
    await unsubscribe(addresses.map((a) => ({ accountId: a.accountId, sender: a.address })));
    setChecked((c) => c.filter((k) => !keys.includes(k)));
  }, [senders, statusByKey, unsubscribe]);

  return { senders, statusByKey, pickable, picked, setChecked, check, run, confirm: confirmUnsubscribe };
}

/** One company or sender in Subscriptions: laid out like a conversation row, opening its latest email. */
function SubscriptionRow({ sender, statuses, query, open, checked, selecting, pickable, onCheck, onUnsubscribe, onConfirm }: {
  sender: Sender;
  /** Each address's unsubscribe, in the order of sender.addresses. */
  statuses: (Unsubscribe | undefined)[];
  query: string;
  open: boolean;
  checked: boolean;
  selecting: boolean;
  pickable: boolean;
  onCheck: (key: string, range: boolean) => void;
  onUnsubscribe: (key: string) => void;
  onConfirm: (id: string) => void;
}) {
  const lit = open || checked;
  const status = rowStatus(statuses);
  // A sender left to confirm on their own page offers that page and a way to say it is done (for every
  // address of the company waiting on it); one that can still be unsubscribed from offers that. Others,
  // already on their way or done, offer nothing.
  const manual = statuses.filter((u): u is Unsubscribe => u?.status === "manual");
  const page = manual.find((u) => u.manualUrl)?.manualUrl;
  const actions: { label: string; icon: LucideIcon; onClick: () => void }[] = selecting ? [] : manual.length > 0 ? [
    ...(page ? [{ label: "Open Their Page", icon: ExternalLink, onClick: () => window.open(page, "_blank", "noopener,noreferrer") }] : []),
    { label: "Mark as Unsubscribed", icon: Check, onClick: () => manual.forEach((u) => onConfirm(u.id)) },
  ] : pickable ? [{ label: "Unsubscribe", icon: MailX, onClick: () => onUnsubscribe(sender.key) }] : [];
  const addresses = sender.addresses.length === 1 ? sender.addresses[0].address : `${sender.addresses.length} Addresses`;

  return (
    <div className={cn("group/row relative rounded-lg", lit ? "bg-muted" : "hover:bg-muted/50")}>
      <Link
        href={withQuery(`/inbox/${sender.latest.id}`, query)}
        data-row-link
        aria-current={open ? "page" : undefined}
        // Cmd or Ctrl-click checks one sender, Shift-click a range. Once any are checked, a click checks too.
        onClick={(e) => {
          if (!(e.shiftKey || e.metaKey || e.ctrlKey || selecting) || !pickable) return;
          e.preventDefault();
          onCheck(sender.key, e.shiftKey);
        }}
        className={cn("flex items-center gap-3 rounded-lg p-3 outline-none focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:ring-inset", actions.length > 0 && FADE[actions.length as 1 | 2])}
      >
        <div className={cn("shrink-0", lit && "[&_[data-slot=avatar-fallback]]:bg-background", pickable && (selecting ? "invisible" : "group-hover/row:invisible group-has-focus-visible/row:invisible group-focus-within/row:invisible pointer-coarse:invisible"))}>
          {sender.company ? (
            <CompanyAvatar logoPath={sender.company.logoPath} className="size-8" />
          ) : (
            <ContactAvatar contact={sender.contact} className="size-8" />
          )}
        </div>
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <div className="flex h-5 items-center justify-between gap-3">
            <span className="min-w-0 truncate text-sm font-medium">{sender.name}</span>
            <span data-hover-hide className="shrink-0 text-xs tabular-nums text-muted-foreground">{sender.count === 1 ? "1 Email" : `${sender.count} Emails`}</span>
          </div>
          <div className="flex h-4 items-center justify-between gap-3">
            <span className="min-w-0 truncate text-xs">{addresses}</span>
            {status && <span data-hover-hide className="shrink-0 text-xs text-muted-foreground">{UNSUBSCRIBE_LABEL[status.status]}</span>}
          </div>
        </div>
      </Link>
      {/* Over the avatar: shown on hover, and on every pickable row once one is checked. */}
      {pickable && (
        <div className={cn("absolute top-1/2 left-3 size-8 -translate-y-1/2 items-center justify-center", selecting ? "flex" : "hidden group-hover/row:flex group-has-focus-visible/row:flex group-focus-within/row:flex pointer-coarse:flex")}>
          <Checkbox
            checked={checked}
            aria-label={`Select ${sender.name}`}
            onClick={(e) => {
              e.preventDefault();
              onCheck(sender.key, e.shiftKey);
            }}
          />
        </div>
      )}
      {actions.length > 0 && (
        <div className="absolute top-1/2 right-3 hidden -translate-y-1/2 items-center gap-1 group-hover/row:flex group-focus-within/row:flex pointer-coarse:flex">
          {actions.map((a) => <RowButton key={a.label} variant="secondary" label={a.label} icon={a.icon} onClick={a.onClick} />)}
        </div>
      )}
    </div>
  );
}

/** The placeholder rows shown while conversations load. */
function LoadingRows() {
  return (
    <div className="flex flex-col gap-2" role="status" aria-busy="true" aria-label="Loading conversations">
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
  );
}

/**
 * Checked rows, shift-click ranges and bulk actions. `order` is the rows top to bottom, the selection clears
 * whenever `reset` changes, and basePath is where it returns when the open conversation goes.
 */
export function useThreadSelection(order: string[], query: string, reset: string, basePath = "/inbox") {
  const params = useParams<{ id?: string }>();
  const router = useRouter();
  const act = useRowActions();

  // Checked conversations. Ones that leave the list (archived, deleted) drop out of the selection.
  const [checked, setChecked] = useState<string[]>([]);
  const anchor = useRef<string | null>(null);
  const picked = useMemo(() => {
    const inList = new Set(order);
    return checked.filter((id) => inList.has(id));
  }, [checked, order]);
  useEffect(() => { setChecked([]); }, [reset]);

  // Acting on the open conversation, or one it moves out of the list, goes back to the list.
  const run = useCallback((ids: string[], action: RowAction) => {
    act(ids, action);
    if (action === "read" || action === "pin") return;
    const gone = new Set(ids);
    setChecked((c) => c.filter((id) => !gone.has(id)));
    if (params.id && gone.has(params.id)) router.push(withQuery(basePath, query));
  }, [act, params.id, router, query, basePath]);

  // Row callbacks and the key handler read the latest list through this ref, so they never change.
  const latest = useRef({ order, picked, run });
  latest.current = { order, picked, run };

  const check = useCallback((id: string, range: boolean) => {
    const from = anchor.current; // read now: the update below runs later, after the anchor has moved
    setChecked((c) => toggleSelection(latest.current.order, c, id, from, range));
    anchor.current = id;
  }, []);

  // Acts on the row, or on the whole selection when the row is part of it.
  const onRowAction = useCallback((id: string, action: RowAction) => {
    const { picked, run } = latest.current;
    run(picked.includes(id) ? picked : [id], action);
  }, []);

  return { picked, setChecked, check, run, onRowAction };
}

export function ThreadList() {
  const { view, filter, query } = useListState();
  const params = useParams<{ id?: string }>();
  const { listThreads, accounts, loading, contactById: contactOf, prefetchMessages } = useApp();
  const noAccounts = !accounts.some((a) => a.status !== "disconnected");
  // A name beside the logo only tells accounts apart, so it shows once there are two of one service.
  const accountNames = useMemo(() => {
    const count = new Map<string, number>();
    for (const a of accounts) count.set(a.provider, (count.get(a.provider) ?? 0) + 1);
    return new Map(accounts.filter((a) => (count.get(a.provider) ?? 0) > 1).map((a) => [a.id, a.nickname || a.label]));
  }, [accounts]);
  const importing = useImporting().length > 0;
  const [search, setSearch] = useState("");
  const term = search.trim().toLowerCase();
  // Already sorted with pinned conversations first. Search matches the row's name, subject and preview.
  const threads = useMemo(() => {
    const all = listThreads(view, filter);
    if (!term) return all;
    return all.filter((t) =>
      [t.isGroup ? t.groupName : contactOf(t.participantIds[0])?.name, t.fallbackName, t.subject, t.preview]
        .some((s) => s?.toLowerCase().includes(term)),
    );
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
