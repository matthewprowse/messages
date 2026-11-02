// Photos sent together shown as one grid (WhatsApp style). Used by the message list.

import { memo } from "react";
import type { Message } from "@/lib/types";
import { timeOf } from "@/lib/format";
import { cn } from "@/lib/utils";
import { ContactAvatar } from "@/components/primitives";
import { AttachmentTile } from "@/components/attachments";
import { BubbleActions, ReactionChips, useTouchReveal } from "@/components/message-extras";
import type { BubbleProps } from "@/components/thread-view/bubble";

/**
 * Photos sent together, as WhatsApp shows them: one grid, two to a row. Each photo keeps its own reactions;
 * Reply and React act on the last one, and the time is the last one's.
 */
export const ImageAlbum = memo(function ImageAlbum({ ms, showMeta, sender, senderContact, whatsapp, flash, nameOf, onReply, onReact, onOpen }: Omit<BubbleProps, "m" | "quotedId" | "onJump" | "onRetry" | "onDismiss"> & { ms: Message[] }) {
  const touch = useTouchReveal();
  const last = ms[ms.length - 1];
  const me = last.from === "me";
  return (
    <div ref={touch.ref} {...touch.props} data-message-id={last.id} className={cn("group/bubble flex flex-col gap-2", me ? "items-end" : "items-start")}>
      <div className={cn("flex max-w-full items-center gap-1", me && "flex-row-reverse")}>
        <div className={cn("grid grid-cols-2 gap-2 rounded-lg ring-ring/50 transition-shadow duration-500", flash && "ring-2")}>
          {ms.flatMap((m) => m.attachments!.map((a) => (
            <AttachmentTile key={a.id} attachment={a} onOpen={() => onOpen(a)} showName={false} />
          )))}
        </div>
        <BubbleActions m={last} canReact={whatsapp} revealed={touch.revealed} onReply={onReply} onReact={onReact} />
      </div>
      {ms.map((m) => <ReactionChips key={m.id} m={m} me={me} nameOf={nameOf} onReact={onReact} canReact={whatsapp} />)}
      {showMeta && (
        <div className="flex items-center gap-1.5 px-3 text-xs text-muted-foreground">
          {sender && <ContactAvatar contact={senderContact} className="size-6" />}
          {sender ? `${sender} · ${timeOf(last.sentAt)}` : timeOf(last.sentAt)}
        </div>
      )}
    </div>
  );
});
