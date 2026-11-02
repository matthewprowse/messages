"use client";

// One promise: a Done checkbox, what was promised, who made it and when it is due, and a Snooze menu. Used by the
// Summary's Promises section and the strip in an open conversation (which passes compact and hides the conversation link).

import Link from "next/link";
import { Clock } from "lucide-react";
import { dueText, type Commitment } from "@/lib/commitments";
import { daysBetween, dayOf } from "@/lib/commitments";
import { snoozeChoices } from "@/lib/snooze";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";

interface Props {
  promise: Commitment;
  /** Who made it, in words: "You" or the other person's name. */
  who: string;
  now: Date;
  /** Where the row opens; none in the open conversation, where it already is. */
  href?: string;
  onDone: (c: Commitment) => void;
  onSnooze: (c: Commitment, until: Date) => void;
}

export function PromiseRow({ promise, who, now, href, onDone, onSnooze }: Props) {
  const late = !!promise.dueOn && daysBetween(dayOf(now), promise.dueOn) < 0;
  const body = (
    <>
      <span className="min-w-0 truncate text-sm font-medium">{promise.text}</span>
      <span className="flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
        <span className="min-w-0 truncate">{who}</span>
        <span className={cn("shrink-0 tabular-nums", late && "text-destructive")}>{dueText(promise, now)}</span>
      </span>
    </>
  );
  return (
    <div className="flex items-center gap-3 rounded-lg p-3 hover:bg-muted/50">
      {/* The whole 32px box is the target, not just the 16px checkbox, for a thumb. */}
      <label className="flex size-8 shrink-0 cursor-pointer items-center justify-center">
        <Checkbox checked={false} onCheckedChange={() => onDone(promise)} aria-label={`Done: ${promise.text}`} />
      </label>
      {href ? (
        <Link href={href} data-row-link className="flex min-w-0 flex-1 flex-col gap-1 rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/50">{body}</Link>
      ) : (
        <div className="flex min-w-0 flex-1 flex-col gap-1">{body}</div>
      )}
      <DropdownMenu>
        <DropdownMenuTrigger asChild><Button variant="ghost" size="icon" aria-label={`Snooze: ${promise.text}`}><Clock /></Button></DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-max">
          {/* Fresh each time it opens, so Later Today is never offered after 15:00. */}
          {snoozeChoices(new Date()).map((c) => <DropdownMenuItem key={c.key} onSelect={() => onSnooze(promise, c.at)}>{c.label}</DropdownMenuItem>)}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
