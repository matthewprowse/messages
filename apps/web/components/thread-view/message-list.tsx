// The scrolling list of a conversation: day dividers, runs of bubbles from one sender, photo albums and meeting cards.
// Layout decisions live in lib/thread-runs.ts; this file only renders them.

import { memo, useMemo, useRef } from "react";
import type { Contact, Message } from "@/lib/types";
import type { Meeting } from "@/lib/meetings";
import { groupByDay, withAlbums } from "@/lib/thread-runs";
import { Separator } from "@/components/ui/separator";
import { MeetingCard } from "@/components/meeting-card";
import { isSticker } from "@/components/attachments";
import { Bubble, type BubbleHandlers } from "@/components/thread-view/bubble";
import { ImageAlbum } from "@/components/thread-view/image-album";

interface ListProps extends BubbleHandlers {
  msgs: Message[];
  /** Meetings with these people, oldest first, shown as cards between the messages around them. */
  meetings: Meeting[];
  isGroup: boolean;
  /** The one message that shows "Seen" (Instagram and LinkedIn). */
  seenId: string | null;
  flashId: string | null;
  senderNames: Map<string, string>;
  senderContacts: Map<string, Contact | undefined>;
}

/* Every conversation renders as a chat, email included. */
export const Messages = memo(function Messages({ msgs, meetings, isGroup, whatsapp, seenId, flashId, senderNames, senderContacts, ...handlers }: ListProps) {
  // A WhatsApp quote names the quoted message by WhatsApp's own ID.
  const byProviderId = useMemo(() => new Map(msgs.flatMap((m) => (m.providerId ? [[m.providerId, m.id] as const] : []))), [msgs]);
  // A run keeps the key of any message it already held (see groupByDay), so it is not remounted as messages come and go.
  const runKeys = useRef(new Map<string, string>());
  const groups = useMemo(() => groupByDay(msgs, meetings, runKeys.current), [msgs, meetings]);
  return (
    <div className="space-y-6" role="log" aria-live="polite" aria-label="Messages">
      {groups.map((g) => (
        <div key={g.key} className="space-y-6">
          <div className="flex items-center gap-3">
            <Separator className="flex-1" />
            <span className="text-xs text-muted-foreground">{g.day}</span>
            <Separator className="flex-1" />
          </div>
          {g.runs.map((run) => {
            if (!Array.isArray(run)) return <MeetingCard key={run.id} meeting={run} place="conversation" />;
            const items = whatsapp ? withAlbums(run, isSticker) : run.map((m) => [m]);
            return (
              <div key={runKeys.current.get(run[0].id) ?? run[0].id} className="flex flex-col gap-2">
                {items.map((ms, i) => {
                  const m = ms[ms.length - 1];
                  const shared = {
                    showMeta: i === items.length - 1,
                    sender: isGroup && m.from !== "me" ? senderNames.get(m.from) : undefined,
                    senderContact: isGroup && m.from !== "me" ? senderContacts.get(m.from) : undefined,
                    whatsapp,
                    seen: m.id === seenId,
                    ...handlers,
                  };
                  return ms.length > 1
                    ? <ImageAlbum key={ms[0].id} ms={ms} flash={ms.some((x) => x.id === flashId)} {...shared} />
                    : <Bubble key={m.id} m={m} flash={flashId === m.id} quotedId={m.quote ? byProviderId.get(m.quote.id) : undefined} {...shared} />;
                })}
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
});
