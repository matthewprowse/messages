// The scrolling timeline of a person's messages across channels: day dividers, one bubble per message with a channel badge
// above it (a link to open that conversation), and a heading around the messages of conversations linked as one matter.
// Layout comes from lib/person-timeline.ts; the bubbles are the same ones a single conversation uses.

import Link from "next/link";
import { memo, useMemo } from "react";
import type { Attachment, Message } from "@/lib/types";
import { dayLabel } from "@/lib/format";
import { threadLabel, type TimelineBlock, type TimelineEntry } from "@/lib/person-timeline";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Bubble } from "@/components/thread-view/bubble";
import type { NameOf } from "@/components/message-extras";
import { ChannelMark, ChannelMarks } from "@/components/person/channel-mark";

export interface TimelineHandlers {
  nameOf: NameOf;
  onReply: (m: Message) => void;
  onReact: (m: Message, emoji: string) => void;
  onOpen: (a: Attachment) => void;
  onRetry: (m: Message) => void;
  onDismiss: (m: Message) => void;
  /** Takes a matter's conversations apart again (they stop showing together). */
  onUnlink: (threadIds: string[]) => void;
}

const noJump = () => undefined;

function Entry({ entry, handlers }: { entry: TimelineEntry; handlers: Omit<TimelineHandlers, "onUnlink"> }) {
  const { message: m, thread } = entry;
  const me = m.from === "me";
  return (
    <div className={cn("flex flex-col gap-1", me ? "items-end" : "items-start")}>
      {/* Opening the conversation from here is the user's choice, so only then is it marked read. */}
      <Link href={`/inbox/${thread.id}?message=${encodeURIComponent(m.id)}`} className="max-w-full rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring/50" title="Open This Conversation">
        <Badge variant="outline" className="max-w-full gap-1 font-normal text-muted-foreground">
          <ChannelMark channel={thread.channel} />
          <span className="truncate">{threadLabel(thread)}</span>
          {thread.unread && <span className="size-1.5 shrink-0 rounded-full bg-primary" aria-label="Unread" />}
        </Badge>
      </Link>
      <Bubble m={m} showMeta flash={false} whatsapp={!!m.whatsapp} {...handlers} onJump={noJump} />
    </div>
  );
}

/** Messages with a divider each time the day changes. */
function Run({ entries, handlers }: { entries: TimelineEntry[]; handlers: Omit<TimelineHandlers, "onUnlink"> }) {
  const now = useMemo(() => new Date(), []);
  return (
    <div className="space-y-4">
      {entries.map((e, i) => {
        const day = new Date(e.message.sentAt).toDateString();
        const newDay = i === 0 || day !== new Date(entries[i - 1].message.sentAt).toDateString();
        return (
          <div key={e.message.id} className="space-y-4">
            {newDay && (
              <div className="flex items-center gap-3">
                <Separator className="flex-1" />
                <h3 className="text-xs font-normal text-muted-foreground">{dayLabel(e.message.sentAt, now)}</h3>
                <Separator className="flex-1" />
              </div>
            )}
            <Entry entry={e} handlers={handlers} />
          </div>
        );
      })}
    </div>
  );
}

export const PersonTimeline = memo(function PersonTimeline({ blocks, ...handlers }: { blocks: TimelineBlock[] } & TimelineHandlers) {
  const { onUnlink, ...rest } = handlers;
  return (
    <div className="space-y-6" role="group" aria-label="Messages">
      {blocks.map((b) => b.kind === "messages" ? (
        <Run key={b.key} entries={b.entries} handlers={rest} />
      ) : (
        <section key={b.key} aria-label={`Matter: ${b.title}`} className="space-y-4 rounded-xl border p-3">
          <header className="flex items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-2">
              <h2 className="min-w-0 truncate text-sm font-medium">{b.title}</h2>
              <ChannelMarks channels={[...new Set(b.entries.map((e) => e.thread.channel))]} />
              <span className="shrink-0 text-xs text-muted-foreground">Same Matter</span>
            </div>
            <Button variant="ghost" size="sm" onClick={() => onUnlink(b.threadIds)}>Unlink</Button>
          </header>
          <Run entries={b.entries} handlers={rest} />
        </section>
      ))}
    </div>
  );
});
