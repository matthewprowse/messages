"use client";

// One conversation row: hover and swipe actions, the checkbox over the avatar, and a right-click menu. Memoised, and
// shared with the Summary list, which links rows to /summary and adds each conversation's AI summary.

import { memo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Archive, MailCheck, OctagonAlert, Pin, Trash2, type LucideIcon } from "lucide-react";
import type { Contact, Thread } from "@/lib/types";
import { niceName, relTime } from "@/lib/format";
import { rowMarker, withQuery } from "@/lib/thread-list";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuSeparator, ContextMenuShortcut, ContextMenuTrigger } from "@/components/ui/context-menu";
import { ContactAvatar, GroupAvatar } from "@/components/primitives";
import { ProviderLogo } from "@/components/provider-logo";
import { WorkTag } from "@/components/work-badge";
import { ROW_FADE, SWIPED_FADE, SWIPE_PX } from "./fade";
import { RowButton } from "./row-button";
import type { RowAction } from "./use-row-actions";

// A row's hover actions, in order from the left.
const ROW_ACTIONS = (thread: Thread): { action: RowAction; label: string; icon: LucideIcon; keys: string; destructive?: boolean }[] => [
  { action: "archive", label: thread.status === "archived" ? "Unarchive" : "Archive", icon: Archive, keys: "e" },
  { action: "trash", label: "Delete", icon: Trash2, keys: "#", destructive: true },
  { action: "junk", label: thread.junk ? "Not Junk" : "Move to Junk", icon: thread.junk ? MailCheck : OctagonAlert, keys: "!" },
];

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
  // 100+ rows would each mount three tooltip buttons and a checkbox that stay hidden until hover, so they mount when the pointer or focus first reaches the row.
  const [armed, setArmed] = useState(false);
  const marker = rowMarker(thread);

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
        <div data-thread-row={thread.id} {...swipe} onPointerEnter={() => setArmed(true)} onFocus={() => setArmed(true)} className={cn("group/row relative touch-pan-y rounded-lg", !summary && "[contain-intrinsic-size:auto_64px] [content-visibility:auto]", lit ? "bg-muted [&_[data-unread]]:bg-background" : "hover:bg-muted/50")}>
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
                  {/* One quiet marker for what the AI found: Urgent, or Needs Reply. */}
                  {marker && <Badge variant={marker === "urgent" ? "destructive" : "secondary"}>{marker === "urgent" ? "Urgent" : "Needs Reply"}</Badge>}
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
          {(armed || selecting || open || checked) && <div className={cn("absolute top-1/2 left-3 size-8 -translate-y-1/2 items-center justify-center", selecting || open ? "flex" : "hidden group-hover/row:flex group-has-focus-visible/row:flex pointer-fine:group-focus-within/row:flex")}>
            <Checkbox
              checked={checked}
              aria-label={`Select ${title}`}
              onClick={(e) => {
                e.preventDefault();
                onCheck(thread.id, e.shiftKey);
                onSwipe?.(null); // checking starts selecting: every row shows its checkbox instead
              }}
            />
          </div>}
          {/* Shown on hover, or slid out by a swipe, over the faded content. */}
          {!selecting && (armed || open) && (
            <div className={cn("absolute top-1/2 right-3 -translate-y-1/2 items-center gap-1", open ? "flex animate-in fade-in-0 slide-in-from-right-4 duration-150" : "hidden group-hover/row:flex pointer-fine:group-focus-within/row:flex")}>
              {ROW_ACTIONS(thread).map((a) => (
                <RowButton
                  key={a.action}
                  variant="secondary"
                  label={a.label}
                  icon={a.icon}
                  keys={a.keys}
                  destructive={a.destructive}
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
        <ContextMenuItem onSelect={() => act("archive")}>{thread.status === "archived" ? "Unarchive" : "Archive"}<ContextMenuShortcut>E</ContextMenuShortcut></ContextMenuItem>
        <ContextMenuItem onSelect={() => act("trash")}>Delete<ContextMenuShortcut>#</ContextMenuShortcut></ContextMenuItem>
        <ContextMenuItem onSelect={() => act("junk")}>{thread.junk ? "Not Junk" : "Move to Junk"}<ContextMenuShortcut>!</ContextMenuShortcut></ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem onSelect={() => act("read")}>{thread.unread ? "Mark as Read" : "Mark as Unread"}<ContextMenuShortcut>U</ContextMenuShortcut></ContextMenuItem>
        <ContextMenuItem onSelect={() => act("pin")}>{thread.pinned ? "Unpin" : "Pin"}</ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
});
