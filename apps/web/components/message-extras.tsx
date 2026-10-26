"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Reply, SmilePlus } from "lucide-react";
import type { Contact, Message } from "@/lib/types";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { ViewOriginal } from "@/components/message-body";

// The parts of a chat bubble beyond its text: the message a reply quotes, reactions, and the Reply and
// React actions that appear on hover, or on tap or long press on touch screens, which cannot hover. They take
// what they need as props, not from the store, so a memoised bubble only redraws when its message changes.

/** WhatsApp's own quick reactions, in its order. */
const QUICK_REACTIONS = ["👍", "❤️", "😂", "😮", "😢", "🙏"];

/** The quoted message at the top of a reply. Clicking it jumps to that message when it is loaded. */
export function QuoteBlock({ quote, me, nameOf, onJump }: { quote: NonNullable<Message["quote"]>; me: boolean; nameOf: NameOf; onJump?: () => void }) {
  // The author was saved when the reply arrived, sometimes before the person had a name: look it up again.
  const author = quote.fromMe ? "You" : /^\+\d+$/.test(quote.author) ? nameOf(quote.author) : quote.author;
  return (
    <button
      type="button"
      onClick={onJump}
      disabled={!onJump}
      className={cn(
        "mb-2 block w-full min-w-0 rounded-md px-2.5 py-1.5 text-left text-xs leading-5 disabled:cursor-default",
        me ? "bg-primary-foreground/10" : "bg-background/60",
      )}
    >
      <span className="block font-medium">{author}</span>
      <span className="line-clamp-3 whitespace-pre-wrap opacity-80 wrap-anywhere">{quote.text}</span>
    </button>
  );
}

export type NameOf = (who: string) => string;
export type OnReact = (message: Message, emoji: string) => void;

/** Who a reaction key is: you, a saved contact by number, or the number itself. */
export function useReactorName(contacts: Contact[]): NameOf {
  return useMemo(() => {
    const byPhone = new Map<string, string>();
    for (const c of contacts) for (const p of c.phones) byPhone.set(p, c.name);
    return (who: string) => (who === "me" ? "You" : byPhone.get(who) ?? who.replace(/@lid$/, ""));
  }, [contacts]);
}

/** Reactions under a bubble, one chip per emoji with a count. Tapping one sets or removes yours. */
export function ReactionChips({ m, me, nameOf, onReact }: { m: Message; me: boolean; nameOf: NameOf; onReact: OnReact }) {
  const chips = useMemo(() => {
    const byEmoji = new Map<string, string[]>();
    for (const [who, emoji] of Object.entries(m.reactions ?? {})) byEmoji.set(emoji, [...(byEmoji.get(emoji) ?? []), who]);
    return [...byEmoji].map(([emoji, people]) => ({ emoji, people, mine: people.includes("me") }));
  }, [m.reactions]);
  if (chips.length === 0) return null;
  return (
    <div className={cn("-mt-1 flex flex-wrap gap-1 px-2", me && "justify-end")}>
      {chips.map((chip) => (
        <Tooltip key={chip.emoji}>
          <TooltipTrigger asChild>
            <button
              type="button"
              aria-pressed={chip.mine}
              aria-label={`${chip.emoji} ${chip.people.length}`}
              onClick={() => onReact(m, chip.mine ? "" : chip.emoji)}
              className={cn(
                "inline-flex h-6 items-center gap-1 rounded-full border bg-background px-2 text-xs shadow-xs transition-colors hover:bg-muted",
                chip.mine && "border-primary/40 bg-secondary",
              )}
            >
              <span>{chip.emoji}</span>
              {chip.people.length > 1 && <span className="text-muted-foreground">{chip.people.length}</span>}
            </button>
          </TooltipTrigger>
          <TooltipContent>{chip.people.map(nameOf).join(", ")}</TooltipContent>
        </Tooltip>
      ))}
    </div>
  );
}

const LONG_PRESS_MS = 450;

/**
 * Touch screens cannot hover, so a bubble's actions show when it is tapped (tap again, or tap elsewhere, to
 * hide them) or pressed and held. Spread props on the bubble's outer element and pass revealed to its actions.
 */
export function useTouchReveal() {
  const ref = useRef<HTMLDivElement>(null);
  const [revealed, setRevealed] = useState(false);
  const touch = useRef(false);
  const held = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => {
    if (!revealed) return;
    function away(e: PointerEvent) {
      if (!ref.current?.contains(e.target as Node)) setRevealed(false);
    }
    document.addEventListener("pointerdown", away);
    return () => document.removeEventListener("pointerdown", away);
  }, [revealed]);
  useEffect(() => () => clearTimeout(timer.current), []);
  const stop = () => clearTimeout(timer.current);
  return {
    ref,
    revealed,
    props: {
      onPointerDown: (e: React.PointerEvent) => {
        touch.current = e.pointerType === "touch";
        held.current = false;
        if (!touch.current) return;
        timer.current = setTimeout(() => { held.current = true; setRevealed(true); }, LONG_PRESS_MS);
      },
      onPointerUp: stop,
      onPointerCancel: stop,
      onPointerMove: stop,
      onClick: (e: React.MouseEvent) => {
        // Clicks from a dialog or popover opened by an action bubble up here in React, but not in the page.
        if (!touch.current || !e.currentTarget.contains(e.target as Node)) return;
        if (held.current) { held.current = false; return; }
        setRevealed((v) => !v);
      },
    },
  };
}

/** Reply, View Original, and React for WhatsApp, beside a message. On touch screens they show once revealed. */
export function BubbleActions({ m, canReact, revealed = false, onReply, onReact }: { m: Message; canReact: boolean; revealed?: boolean; onReply: (m: Message) => void; onReact: OnReact }) {
  const [open, setOpen] = useState(false);
  const mine = m.reactions?.me;
  return (
    <div
      className={cn(
        "flex shrink-0 items-center gap-1 opacity-0 transition-opacity group-hover/bubble:opacity-100 focus-within:opacity-100",
        revealed ? "[@media(hover:none)]:opacity-100" : "[@media(hover:none)]:pointer-events-none",
        open && "opacity-100",
      )}
    >
      <Tooltip>
        <TooltipTrigger asChild>
          <Button variant="ghost" size="icon" className="text-muted-foreground" aria-label="Reply" onClick={() => onReply(m)}><Reply /></Button>
        </TooltipTrigger>
        <TooltipContent>Reply</TooltipContent>
      </Tooltip>
      {m.hasOriginal && <ViewOriginal messageId={m.id} />}
      {canReact && (
        <Popover open={open} onOpenChange={setOpen}>
          <Tooltip>
            <TooltipTrigger asChild>
              <PopoverTrigger asChild>
                <Button variant="ghost" size="icon" className="text-muted-foreground" aria-label="React"><SmilePlus /></Button>
              </PopoverTrigger>
            </TooltipTrigger>
            <TooltipContent>React</TooltipContent>
          </Tooltip>
          <PopoverContent className="w-auto flex-row gap-1 p-1" side="top">
            {QUICK_REACTIONS.map((emoji) => (
              <Button
                key={emoji}
                variant={mine === emoji ? "secondary" : "ghost"}
                size="icon"
                className="size-9 text-lg"
                aria-label={mine === emoji ? `Remove ${emoji}` : `React ${emoji}`}
                onClick={() => { onReact(m, mine === emoji ? "" : emoji); setOpen(false); }}
              >
                {emoji}
              </Button>
            ))}
          </PopoverContent>
        </Popover>
      )}
    </div>
  );
}
