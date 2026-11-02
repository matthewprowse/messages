"use client";

// The grid of files used by the Attachments page, a contact's page and a conversation: tiles added a page at a time
// as the end scrolls near, optionally under month headings, with the viewer opened on a tile.

import { Fragment, memo, useEffect, useMemo, useRef, useState } from "react";
import { useApp } from "@/lib/store";
import { filesLabel, messageHref, monthKey, monthTitle } from "@/lib/attachment-view";
import type { FiledAttachment } from "@/lib/types";
import { fullDate, stampOf } from "@/lib/format";
import { cn } from "@/lib/utils";
import { AttachmentTile } from "./tile";
import { AttachmentViewer } from "./viewer";
import { useSeen } from "./use-seen";

// Tiles are added a page at a time as the end of the grid scrolls near, so a library of thousands
// of files does not mount thousands of tiles up front.
const GRID_PAGE = 120;

/** Calls onSeen once when it comes near the screen. Remount it (a new key) to watch again. */
function MoreSentinel({ onSeen }: { onSeen: () => void }) {
  const box = useRef<HTMLDivElement>(null);
  const seen = useSeen(box);
  const call = useRef(onSeen);
  useEffect(() => { call.current = onSeen; });
  useEffect(() => { if (seen) call.current(); }, [seen]);
  return <div ref={box} className="col-span-full h-px" aria-hidden />;
}

/** One tile in the grid. Memoized with a stable onView, so loading more files or a store change does not redraw every tile. */
const GridTile = memo(function GridTile({ attachment: a, sender, onView }: { attachment: FiledAttachment; sender: string; onView: (a: FiledAttachment) => void }) {
  return (
    <>
      <AttachmentTile
        attachment={a}
        onOpen={() => onView(a)}
        showName={false}
        overlay={<><span className="truncate">{sender}</span><span className="truncate text-[10px] opacity-80">{fullDate(a.sentAt)}</span></>}
        className="aspect-square size-auto w-full"
      />
      {/* A document is told apart by its name, so it is written under the tile; a photo or video needs no caption. */}
      {a.kind !== "image" && a.kind !== "video" && <span className="line-clamp-2 break-words text-xs text-muted-foreground">{a.name}</span>}
    </>
  );
});

/**
 * Files gathered from many messages, newest first; a document shows its name, and everything shows who sent it and when
 * on hover. With byMonth, a header with a count starts each month. Given onToggleHidden, the viewer offers Hide and Unhide.
 */
export function AttachmentGrid({ items, hrefFor = messageHref, className, byMonth = false, onToggleHidden, onEnd }: { items: FiledAttachment[]; hrefFor?: (a: FiledAttachment) => string; className?: string; byMonth?: boolean; /** Hides or unhides a file; resolves true when it was saved. */ onToggleHidden?: (a: FiledAttachment) => Promise<boolean>; /** Called when the end of the files scrolls near, to load the next page. */ onEnd?: () => void }) {
  const { contactById } = useApp();
  const [viewing, setViewing] = useState<FiledAttachment | null>(null);
  const [limit, setLimit] = useState(GRID_PAGE);
  const who = (from: string) => (from === "me" ? "You" : contactById(from)?.name ?? "Unknown");
  const perMonth = useMemo(() => {
    const counts = new Map<string, number>();
    if (byMonth) for (const a of items) counts.set(monthKey(a.sentAt), (counts.get(monthKey(a.sentAt)) ?? 0) + 1);
    return counts;
  }, [items, byMonth]);
  const at = viewing ? items.findIndex((a) => a.id === viewing.id) : -1;
  // A file that is hidden or unhidden leaves this list: the viewer moves to its neighbour, or closes on the last one.
  const toggleHidden = onToggleHidden && viewing
    ? async () => {
        const index = items.findIndex((x) => x.id === viewing.id);
        if (await onToggleHidden(viewing)) setViewing(items[index + 1] ?? items[index - 1] ?? null);
      }
    : undefined;
  let month = "";
  return (
    <>
      <div className={cn("grid grid-cols-3 gap-x-3 gap-y-4 md:grid-cols-6", className)}>
        {items.slice(0, limit).map((a) => {
          const key = monthKey(a.sentAt);
          const header = byMonth && key !== month;
          month = key;
          return (
            <Fragment key={a.id}>
              {header && (
                <h2 className="col-span-full flex items-baseline gap-2 pt-2 first:pt-0">
                  <span className="text-sm font-medium">{monthTitle(a.sentAt)}</span>
                  <span className="text-xs text-muted-foreground">{filesLabel(perMonth.get(key) ?? 0)}</span>
                </h2>
              )}
              <div className="flex min-w-0 flex-col gap-1">
                <GridTile attachment={a} sender={who(a.from)} onView={setViewing} />
              </div>
            </Fragment>
          );
        })}
        {items.length > limit && <MoreSentinel key={limit} onSeen={() => setLimit((n) => n + GRID_PAGE)} />}
        {/* Every loaded tile is on screen and the server has more: asking again when the end scrolls near. */}
        {items.length <= limit && onEnd && <MoreSentinel key={`end-${items.length}`} onSeen={onEnd} />}
      </div>
      <AttachmentViewer
        attachment={viewing}
        detail={viewing ? `${who(viewing.from)}, ${stampOf(viewing.sentAt)}` : undefined}
        sender={viewing ? { name: who(viewing.from), contact: viewing.from === "me" ? undefined : contactById(viewing.from), me: viewing.from === "me" } : undefined}
        sentAt={viewing?.sentAt}
        href={viewing ? hrefFor(viewing) : undefined}
        items={items}
        index={at}
        onNavigate={(i) => { if (items[i]) setViewing(items[i]); }}
        onClose={() => setViewing(null)}
        onToggleHidden={toggleHidden}
      />
    </>
  );
}
