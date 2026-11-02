// One message bubble with its attachments, quote, reactions, send status and time line. Memoised with stable props so a
// new message or a reaction redraws only the bubbles it changes.

import { memo, useState } from "react";
import { toast } from "sonner";
import { Check, CheckCheck } from "lucide-react";
import type { Attachment, Contact, Message } from "@/lib/types";
import { timeOf } from "@/lib/format";
import { sendStateLabel } from "@/lib/thread-send-state";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { ContactAvatar } from "@/components/primitives";
import { AttachmentTile, StickerImage, isSticker } from "@/components/attachments";
import { MessageBody, hasFullText } from "@/components/message-body";
import { VoiceNote } from "@/components/media-player";
import { BubbleActions, QuoteBlock, ReactionChips, useTouchReveal, type NameOf, type OnReact } from "@/components/message-extras";

/** The handlers and flags every bubble in the list shares. */
export interface BubbleHandlers {
  whatsapp: boolean;
  nameOf: NameOf;
  onJump: (id: string) => void;
  onReply: (m: Message) => void;
  onReact: OnReact;
  onOpen: (a: Attachment) => void;
  onRetry: (m: Message) => void;
  onDismiss: (m: Message) => void;
}

export interface BubbleProps extends BubbleHandlers {
  m: Message;
  showMeta: boolean;
  /** Shows "Seen" under it: the last message you sent that the other person has seen. */
  seen?: boolean;
  /** The sender's name and photo, shown in groups. */
  sender?: string;
  senderContact?: Contact;
  flash: boolean;
  quotedId?: string;
}

export const Bubble = memo(function Bubble({ m, showMeta, seen, sender, senderContact, whatsapp, flash, quotedId, nameOf, onJump, onReply, onReact, onOpen, onRetry, onDismiss }: BubbleProps) {
  const touch = useTouchReveal();
  const me = m.from === "me";
  const bulk = !!m.bulk;
  const [showFull, setShowFull] = useState(false);
  const expandable = hasFullText(m, whatsapp, bulk);
  // A sticker, photo or file sent with no words shows on its own, without an empty bubble.
  const showBubble = !!(m.body.trim() || m.quoted || m.quote || !m.attachments?.length);
  // Replies and reactions need a stored message: not one still sending, and not one its sender deleted.
  const actions = !m.sendState && !m.deleted ? <BubbleActions m={m} canReact={whatsapp} revealed={touch.revealed} onReply={onReply} onReact={onReact} expand={expandable ? { open: showFull, toggle: () => setShowFull((v) => !v) } : undefined} /> : null;
  return (
    <div ref={touch.ref} {...touch.props} data-message-id={m.id} className={cn("group/bubble flex flex-col gap-2", me ? "items-end" : "items-start")}>
      {m.attachments && m.attachments.length > 0 && (
        <div className={cn("flex max-w-full items-center gap-1", me && "flex-row-reverse")}>
          <div className={cn("flex flex-wrap gap-2", me && "justify-end")}>
            {m.attachments.map((a) =>
              isSticker(a) && a.path
                ? <StickerImage key={a.id} attachment={a} onOpen={() => onOpen(a)} />
                : a.kind === "audio"
                  ? <VoiceNote key={a.id} attachment={a} me={me} transcript={m.transcript} />
                  : <AttachmentTile key={a.id} attachment={a} onOpen={() => onOpen(a)} showName={!(whatsapp && a.kind === "image")} />,
            )}
          </div>
          {!showBubble && actions}
        </div>
      )}
      {showBubble && (
        <div className={cn("flex max-w-[80%] items-center gap-1", me && "flex-row-reverse")}>
          <div className={cn("min-w-0 rounded-lg p-3 text-sm leading-6 ring-ring/50 transition-shadow duration-500", me ? "rounded-br-[2px] bg-primary text-primary-foreground" : "rounded-bl-[2px] bg-muted", flash && "ring-2")}>
            {m.quote && <QuoteBlock quote={m.quote} me={me} nameOf={nameOf} onJump={quotedId ? () => onJump(quotedId) : undefined} />}
            {/* Email text is always shown as plain text. Sender-supplied HTML never reaches the page. */}
            {m.deleted ? <p className="opacity-70">{m.body}</p> : <MessageBody m={m} whatsapp={whatsapp} bulk={bulk} showFull={showFull} />}
          </div>
          {actions}
        </div>
      )}
      {/* Received messages show their reactions on the line below, after the name, date and time. */}
      {(me || !showMeta) && <ReactionChips m={m} me={me} nameOf={nameOf} onReact={onReact} />}
      {m.sendState === "failed" ? (
        <div className="flex flex-wrap items-center gap-1 px-3 text-xs text-destructive">
          {/* A failure that may have gone out never offers Retry: check the Sent folder, or copy the text to send it by hand. */}
          <span>{m.sendRecovery === "unsure" ? `May Have Been Sent. ${m.sendError ?? ""}`.trim() : m.sendError ?? "Not Sent"}</span>
          {/* Files cannot be re-queued from here, so a failed send with files can only be deleted. */}
          {m.sendRecovery === "retry" && <Button variant="ghost" size="xs" onClick={() => onRetry(m)}>Retry</Button>}
          {m.sendRecovery === "unsure" && <Button variant="ghost" size="xs" onClick={() => { navigator.clipboard?.writeText(m.body).then(() => toast("Copied")).catch(() => toast("Could not copy")); }}>Copy Text</Button>}
          <Button variant="ghost" size="xs" onClick={() => onDismiss(m)}>Delete</Button>
        </div>
      ) : m.sendState ? (
        <div className="px-3 text-xs text-muted-foreground">{sendStateLabel(m.sendState)}</div>
      ) : (
        (showMeta || m.edited || (me && (whatsapp ? m.receipt : seen))) && (
          <div className="flex items-center gap-1.5 px-3 text-xs text-muted-foreground">
            <span className="flex min-w-0 items-center gap-1.5">
              {sender && showMeta && <ContactAvatar contact={senderContact} className="size-6" />}
              <span className="truncate">
                {showMeta ? (sender ? `${sender} · ${timeOf(m.sentAt)}` : timeOf(m.sentAt)) : ""}
                {m.edited ? (showMeta ? " · Edited" : "Edited") : ""}
              </span>
              {me && (whatsapp ? m.receipt && <Ticks receipt={m.receipt} /> : seen && <span>Seen</span>)}
            </span>
            {!me && showMeta && <ReactionChips m={m} me={false} nameOf={nameOf} onReact={onReact} inline />}
          </div>
        )
      )}
    </div>
  );
});

/** WhatsApp's ticks under a message you sent: one for sent, two for delivered, two in blue once read. */
function Ticks({ receipt }: { receipt: NonNullable<Message["receipt"]> }) {
  const Icon = receipt === "sent" ? Check : CheckCheck;
  const label = receipt === "read" ? "Read" : receipt === "delivered" ? "Delivered" : "Sent";
  return <Icon className={cn("size-3.5 shrink-0", receipt === "read" && "text-blue-500")} aria-label={label} />;
}
