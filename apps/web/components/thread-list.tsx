"use client";

import { Fragment, memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { Archive, Check, ExternalLink, Inbox as InboxIcon, Mail, MailCheck, MailX, OctagonAlert, Trash2, X, type LucideIcon } from "lucide-react";
import { useApp } from "@/lib/store";
import type { Contact, ListFilter, Thread, Unsubscribe, View } from "@/lib/types";
import { relTime } from "@/lib/format";
import { shortcutAction, toggleSelection, type ShortcutAction } from "@/lib/selection";
import { cn } from "@/lib/utils";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuSeparator, ContextMenuShortcut, ContextMenuTrigger } from "@/components/ui/context-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { ContactAvatar, EmptyState } from "@/components/primitives";

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
];

const EMPTY: Record<View, { title: string; description: string }> = {
  all: { title: "You're All Caught Up", description: "New messages appear within seconds of arriving." },
  priority: { title: "Nothing Needs You Right Now", description: "Urgent and important conversations appear here." },
  junk: { title: "No Junk", description: "Spam and cold outreach the AI sorts out lands here." },
  subscriptions: { title: "No Subscriptions", description: "Newsletters, promotions and alerts you can unsubscribe from land here." },
};

// Key handlers leave these alone so typing, menus and dialogs keep their keys. A closed select (the
// From picker) jumps by letter, so it is included too.
const TYPING = "input, textarea, select, [contenteditable=true], [role=menu], [role=dialog], [role=listbox], [role=combobox]";

function withQuery(path: string, query: string) {
  return query ? `${path}?${query}` : path;
}

function listHref(view: View, filter: ListFilter) {
  const p = new URLSearchParams();
  if (view !== "all") p.set("view", view);
  if (filter !== "none") p.set("filter", filter);
  return withQuery("/inbox", p.toString());
}

function filterOf(raw: string | null): ListFilter {
  return raw && FILTER_OPTIONS.some((o) => o.key === raw) ? (raw as ListFilter) : "none";
}

function useListState() {
  const params = useSearchParams();
  const viewParam = params.get("view");
  const view: View = viewParam === "priority" || viewParam === "junk" || viewParam === "subscriptions" ? viewParam : "all";
  const filter = filterOf(params.get("filter"));
  // A message jumped to from search belongs to one conversation, so it is not carried into list links.
  const query = new URLSearchParams(params);
  query.delete("message");
  return { view, filter, query: query.toString() };
}

/** True while a sideways scroller has more content past its right edge. */
function useMoreToRight<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [more, setMore] = useState(false);
  const update = useCallback(() => {
    const el = ref.current;
    if (el) setMore(el.scrollLeft + el.clientWidth < el.scrollWidth - 1);
  }, []);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, [update]);
  return { ref, more, onScroll: update };
}

function ListControls({ view, filter }: { view: View; filter: ListFilter }) {
  const router = useRouter();
  const views = useMoreToRight<HTMLElement>();
  return (
    <div className="flex items-center justify-between gap-3">
      {/* The views scroll sideways when the column is too narrow, fading out beside the filter until the end. */}
      <div className="relative min-w-0 flex-1">
        <nav ref={views.ref} onScroll={views.onScroll} aria-label="View" className="flex items-center gap-1 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {VIEWS.map((v) => (
            <Button key={v.key} asChild variant={view === v.key ? "secondary" : "ghost"} className={cn("shrink-0 px-2", view !== v.key && "text-muted-foreground")}>
              <Link href={listHref(v.key, filter)} aria-current={view === v.key ? "page" : undefined}>{v.label}</Link>
            </Button>
          ))}
        </nav>
        {views.more && <div className="pointer-events-none absolute inset-y-0 right-0 w-8 bg-linear-to-r from-transparent to-background" />}
      </div>
      <Select value={filter === "none" ? "" : filter} onValueChange={(f) => router.push(listHref(view, f as ListFilter))}>
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

function RowButton({ label, icon: Icon, onClick, variant = "ghost", className }: { label: string; icon: LucideIcon; onClick: () => void; variant?: "ghost" | "outline"; className?: string }) {
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
  1: "group-hover/row:[mask-image:linear-gradient(to_right,black_calc(100%-76px),transparent_calc(100%-44px))] [&_[data-hover-hide]]:group-hover/row:invisible",
  2: "group-hover/row:[mask-image:linear-gradient(to_right,black_calc(100%-112px),transparent_calc(100%-80px))] [&_[data-hover-hide]]:group-hover/row:invisible",
  3: "group-hover/row:[mask-image:linear-gradient(to_right,black_calc(100%-148px),transparent_calc(100%-116px))] [&_[data-hover-hide]]:group-hover/row:invisible",
};

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
// Exported for the Summary page, which links rows to /briefing and shows each conversation's AI summary.
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
  /** Where the row links: /inbox by default, /briefing on the Summary page. */
  baseHref?: string;
  /** An extra line under the preview, such as the AI summary. */
  summary?: string;
}) {
  const router = useRouter();
  const title = thread.isGroup ? thread.groupName : contact?.name ?? thread.fallbackName ?? "Unknown";
  // Email rows show the subject, chats show the latest message.
  const preview = (thread.channel === "email" ? thread.subject : undefined) ?? thread.preview ?? "";
  const href = withQuery(`${baseHref}/${thread.id}`, query);
  const unreadCount = thread.unreadCount;
  const lit = selected || checked;
  // Viewport prefetching would fetch every row, so a row is fetched once the pointer or focus reaches it.
  const prefetch = () => router.prefetch(href);
  const act = (action: RowAction) => onAction(thread.id, action);

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div data-thread-row={thread.id} className={cn("group/row relative rounded-lg", lit ? "bg-muted [&_[data-unread]]:bg-background" : "hover:bg-muted/50")}>
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
              if (!(e.shiftKey || e.metaKey || e.ctrlKey || selecting)) return;
              e.preventDefault();
              onCheck(thread.id, e.shiftKey);
            }}
            // While rows are checked the header has the actions, so rows show none and nothing fades.
            className={cn("flex items-center gap-3 rounded-lg p-3 outline-none focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:ring-inset", !selecting && FADE[3])}
          >
            <div className={cn("shrink-0", lit && "[&_[data-slot=avatar-fallback]]:bg-background", selecting ? "invisible" : "group-hover/row:invisible group-has-focus-visible/row:invisible")}>
              {/* A group's own picture, or the other person's photo. */}
              <ContactAvatar contact={thread.isGroup ? thread : contact} className="size-8" />
            </div>
            {/* 20px name line + 4px gap + 16px preview line. */}
            <div className="flex min-w-0 flex-1 flex-col gap-1">
              <div className="flex h-5 items-center justify-between gap-3">
                <span className="min-w-0 truncate text-sm font-medium">{title}</span>
                <span data-hover-hide className="shrink-0 text-xs tabular-nums text-muted-foreground">{relTime(thread.lastMessageAt)}</span>
              </div>
              <div className="flex h-4 items-center justify-between gap-3">
                <span className="min-w-0 truncate text-xs">{preview}</span>
                {unreadCount > 0 && (
                  <span data-unread className="-my-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-medium" data-hover-hide aria-label={`${unreadCount} unread`}>
                    {unreadCount}
                  </span>
                )}
              </div>
              {summary && <p className="line-clamp-2 text-xs text-muted-foreground">{summary}</p>}
            </div>
          </Link>
          {/* Over the avatar: shown on hover, and on every row once one is checked. */}
          <div className={cn("absolute top-1/2 left-3 size-8 -translate-y-1/2 items-center justify-center", selecting ? "flex" : "hidden group-hover/row:flex group-has-focus-visible/row:flex")}>
            <Checkbox
              checked={checked}
              aria-label={`Select ${title}`}
              onClick={(e) => {
                e.preventDefault();
                onCheck(thread.id, e.shiftKey);
              }}
            />
          </div>
          {/* Shown on hover, over the faded content. */}
          {!selecting && (
            <div className="absolute top-1/2 right-3 hidden -translate-y-1/2 items-center gap-1 group-hover/row:flex">
              {ROW_ACTIONS(thread).map((a) => (
                <RowButton
                  key={a.action}
                  variant="outline"
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
function BulkBar({ allPicked, onAll, onClear, children }: { allPicked: boolean; onAll: () => void; onClear: () => void; children: React.ReactNode }) {
  return (
    <div className="flex h-8 items-center justify-between gap-3">
      {/* Once every row is checked, the same button clears them all. */}
      <Button variant="secondary" onClick={allPicked ? onClear : onAll}>{allPicked ? "Deselect All" : "Select All"}</Button>
      <div className="flex items-center gap-1">
        {children}
        <RowButton label="Clear Selection" icon={X} onClick={onClear} />
      </div>
    </div>
  );
}

/** The header's actions on checked conversations. */
export function SelectionBar({ allPicked, anyUnread, onAll, onClear, onAction }: { allPicked: boolean; anyUnread: boolean; onAll: () => void; onClear: () => void; onAction: (action: RowAction) => void }) {
  return (
    <BulkBar allPicked={allPicked} onAll={onAll} onClear={onClear}>
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

interface Sender {
  key: string;
  accountId: string;
  address: string;
  name: string;
  contact?: Contact;
  latest: Thread;
  count: number;
}

/**
 * Subscriptions grouped by sender, so whole senders can be picked and unsubscribed from in one go. The
 * list keeps the checked senders so its header can act on them. The selection clears when `reset` changes.
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
      const key = `${t.accountId}:${address}`;
      const existing = byKey.get(key);
      if (existing) {
        existing.count++;
        if (t.lastMessageAt > existing.latest.lastMessageAt) existing.latest = t;
      } else {
        byKey.set(key, { key, accountId: t.accountId, address, name: contact?.name ?? address, contact, latest: t, count: 1 });
      }
    }
    return [...byKey.values()].sort((a, b) => b.latest.lastMessageAt.localeCompare(a.latest.lastMessageAt));
  }, [items, contactOf]);

  // Keyed like a sender, so each row finds its status without scanning.
  const statusByKey = useMemo(() => new Map(unsubscribes.map((u) => [`${u.accountId}:${u.sender}`, u])), [unsubscribes]);
  const pickable = useMemo(
    () => senders.filter((s) => { const status = statusByKey.get(s.key)?.status; return !status || !UNPICKABLE.has(status); }).map((s) => s.key),
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

  const run = useCallback(async (keys: string[]) => {
    const chosen = senders.filter((s) => keys.includes(s.key));
    if (chosen.length === 0) return;
    await unsubscribe(chosen.map((s) => ({ accountId: s.accountId, sender: s.address })));
    setChecked((c) => c.filter((k) => !keys.includes(k)));
  }, [senders, unsubscribe]);

  // Escape clears the selection, as it does for conversations.
  const anyPicked = picked.length > 0;
  useEffect(() => {
    if (!anyPicked) return;
    function onKey(e: KeyboardEvent) {
      if (e.key !== "Escape" || (e.target as HTMLElement | null)?.closest(TYPING)) return;
      setChecked([]);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [anyPicked]);

  return { senders, statusByKey, pickable, picked, setChecked, check, run, confirm: confirmUnsubscribe };
}

/** One sender in Subscriptions: laid out like a conversation row, opening its latest email. */
function SubscriptionRow({ sender, status, query, open, checked, selecting, pickable, onCheck, onUnsubscribe, onConfirm }: {
  sender: Sender;
  status?: Unsubscribe;
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
  // A sender left to confirm on their own page offers that page and a way to say it is done; one that can
  // still be unsubscribed from offers that. Others, already on their way or done, offer nothing.
  const manual = status?.status === "manual" ? status : undefined;
  const actions: { label: string; icon: LucideIcon; onClick: () => void }[] = selecting ? [] : manual ? [
    ...(manual.manualUrl ? [{ label: "Open Their Page", icon: ExternalLink, onClick: () => window.open(manual.manualUrl, "_blank", "noopener,noreferrer") }] : []),
    { label: "Mark as Unsubscribed", icon: Check, onClick: () => onConfirm(manual.id) },
  ] : pickable ? [{ label: "Unsubscribe", icon: MailX, onClick: () => onUnsubscribe(sender.key) }] : [];

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
        <div className={cn("shrink-0", lit && "[&_[data-slot=avatar-fallback]]:bg-background", pickable && (selecting ? "invisible" : "group-hover/row:invisible group-has-focus-visible/row:invisible"))}>
          <ContactAvatar contact={sender.contact} className="size-8" />
        </div>
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <div className="flex h-5 items-center justify-between gap-3">
            <span className="min-w-0 truncate text-sm font-medium">{sender.name}</span>
            <span data-hover-hide className="shrink-0 text-xs tabular-nums text-muted-foreground">{sender.count === 1 ? "1 Email" : `${sender.count} Emails`}</span>
          </div>
          <div className="flex h-4 items-center justify-between gap-3">
            <span className="min-w-0 truncate text-xs">{sender.address}</span>
            {status && <span data-hover-hide className="shrink-0 text-xs text-muted-foreground">{UNSUBSCRIBE_LABEL[status.status]}</span>}
          </div>
        </div>
      </Link>
      {/* Over the avatar: shown on hover, and on every pickable row once one is checked. */}
      {pickable && (
        <div className={cn("absolute top-1/2 left-3 size-8 -translate-y-1/2 items-center justify-center", selecting ? "flex" : "hidden group-hover/row:flex group-has-focus-visible/row:flex")}>
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
        <div className="absolute top-1/2 right-3 hidden -translate-y-1/2 items-center gap-1 group-hover/row:flex">
          {actions.map((a) => <RowButton key={a.label} variant="outline" label={a.label} icon={a.icon} onClick={a.onClick} />)}
        </div>
      )}
    </div>
  );
}

/** The placeholder rows shown while conversations load. */
function LoadingRows() {
  return (
    <div className="flex flex-col gap-2" aria-label="Loading conversations">
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

/** Checked conversations and the actions on them. `order` is the rows top to bottom, and the selection clears whenever `reset` changes. */
/** Checked rows, shift-click ranges and bulk actions. basePath is where it returns when the open conversation goes. */
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

  // E, # or Delete, and ! act on the checked conversations, or the row with keyboard focus. Otherwise
  // the open conversation handles them. Listening first, during capture, lets the list claim the key.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const target = e.target as HTMLElement | null;
      if (target?.closest(TYPING)) return;
      // Only a row focused from the keyboard counts. A clicked row, or one a closing dialog hands focus
      // back to, is not necessarily the conversation on screen.
      const focused = target?.matches(":focus-visible") ? target.closest<HTMLElement>("[data-thread-row]")?.dataset.threadRow : undefined;
      const { picked, run } = latest.current;
      const ids = picked.length > 0 ? picked : focused ? [focused] : [];
      if (ids.length === 0) return;
      if (e.key === "Escape" && picked.length > 0) {
        e.stopPropagation();
        setChecked([]);
        return;
      }
      const action = shortcutAction(e);
      if (!action) return;
      e.preventDefault();
      e.stopPropagation();
      run(ids, action);
    }
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, []);

  return { picked, setChecked, check, run, onRowAction };
}

/**
 * J and K move keyboard focus down and up the rows inside the returned element, starting from the
 * focused or open row, and Enter then opens it. E and the other shortcuts act on the focused row.
 */
function useRowNavigation<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.metaKey || e.ctrlKey || e.altKey || (e.key !== "j" && e.key !== "k")) return;
      if ((e.target as HTMLElement | null)?.closest(TYPING)) return;
      const rows = [...(ref.current?.querySelectorAll<HTMLElement>("[data-row-link]") ?? [])];
      if (rows.length === 0) return;
      const from = rows.findIndex((r) => r === document.activeElement);
      const at = from !== -1 ? from : rows.findIndex((r) => r.getAttribute("aria-current") === "page");
      const next = at === -1 ? 0 : Math.min(rows.length - 1, Math.max(0, at + (e.key === "j" ? 1 : -1)));
      e.preventDefault();
      rows[next].focus({ preventScroll: true });
      rows[next].scrollIntoView({ block: "nearest" });
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  return ref;
}

export function ThreadList() {
  const { view, filter, query } = useListState();
  const params = useParams<{ id?: string }>();
  const { listThreads, loading, contactById: contactOf, prefetchMessages } = useApp();
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
  const rowsRef = useRowNavigation<HTMLDivElement>();
  const today = useToday();

  return (
    // The header sits above the scroll area, so the rows and their scrollbar both start below it.
    <div className="flex h-full min-h-0 flex-col">
      <div className="shrink-0">
        <div className="space-y-3 border-b p-3">
          <h1 className="flex h-8 items-center text-lg font-medium">Conversations</h1>
          {view === "subscriptions" && subs.picked.length > 0 ? (
            <BulkBar allPicked={subs.picked.length === subs.pickable.length} onAll={() => subs.setChecked(subs.pickable)} onClear={() => subs.setChecked([])}>
              <RowButton label="Unsubscribe" icon={MailX} onClick={() => subs.run(subs.picked)} />
            </BulkBar>
          ) : picked.length > 0 && view !== "subscriptions" ? (
            <SelectionBar
              allPicked={picked.length === order.length}
              anyUnread={threads.some((t) => t.unread && pickedSet.has(t.id))}
              onAll={() => setChecked(order)}
              onClear={() => setChecked([])}
              onAction={(action) => run(picked, action)}
            />
          ) : (
            <ListControls view={view} filter={filter} />
          )}
        </div>
        <div className="border-b p-3">
          <Input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Escape" && search) { e.stopPropagation(); setSearch(""); } }}
            placeholder="Search Conversations"
            aria-label="Search Conversations"
          />
        </div>
      </div>
      <ScrollArea className="min-h-0 flex-1">
        <div ref={rowsRef} className="p-3">
          {loading && <LoadingRows />}
          {!loading && threads.length === 0 && (
            <div className="py-24">
              {term ? (
                <EmptyState icon={InboxIcon} title="No Matches" description="No conversations match your search." />
              ) : (
                <EmptyState icon={InboxIcon} title={EMPTY[view].title} description={EMPTY[view].description} />
              )}
            </div>
          )}
          {view === "subscriptions" ? (
            <div className="flex flex-col gap-2">
              {subs.senders.map((s, i) => (
                <Fragment key={s.key}>
                  {i > 0 && <div className="pl-14"><Separator /></div>}
                  <SubscriptionRow
                    sender={s}
                    status={subs.statusByKey.get(s.key)}
                    query={query}
                    open={params.id === s.latest.id}
                    checked={subsPicked.has(s.key)}
                    selecting={subs.picked.length > 0}
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
              {threads.map((t, i) => (
                <Fragment key={t.id}>
                  {i > 0 && <div className="pl-14"><Separator /></div>}
                  <ThreadRow
                    thread={t}
                    today={today}
                    contact={t.isGroup ? undefined : contactOf(t.participantIds[0])}
                    query={query}
                    selected={params.id === t.id}
                    checked={pickedSet.has(t.id)}
                    selecting={picked.length > 0}
                    onCheck={check}
                    onAction={onRowAction}
                    onPress={prefetchMessages}
                  />
                </Fragment>
              ))}
            </div>
          )}
        </div>
      </ScrollArea>
    </div>
  );
}
