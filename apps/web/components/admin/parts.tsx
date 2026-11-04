"use client";

// The pieces every Admin view is built from, on top of the shared surface kit (components/surface.tsx): a number card with
// a short note under it, the grid they sit in, a quiet line for an empty card, the loading and failed cards, a card that
// opens on demand, the red, amber and green mark and a spend sparkline. Tables are in table.tsx, bar charts in bars.tsx.

import { useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import { sparkPath, type Level } from "@/lib/admin-ops";
import { Alert, AlertAction, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Card } from "@/components/surface";
import { SMALL_SAMPLE, of, percent, share } from "./format";

/**
 * A number in a card with its label above it and an optional short note under it: StatCard's look, plus the note the
 * analytics numbers need (the change on the period before). Undefined is still loading.
 */
export function Stat({ label, value, note, alert = false }: { label: string; value: ReactNode | undefined; note?: string; alert?: boolean }) {
  return (
    <div className="flex min-w-0 flex-col gap-1 rounded-lg border bg-background p-4">
      <span className="truncate text-sm text-muted-foreground">{label}</span>
      {value === undefined ? <Skeleton className="h-8 w-10" /> : <span className={cn("truncate text-2xl font-medium tabular-nums", alert && "text-destructive")}>{value}</span>}
      {note && <span className="text-xs text-muted-foreground">{note}</span>}
    </div>
  );
}

/** A share as a number card: the count is the figure ("42 of 118"), the percentage the note. A small sample says so. */
export function CountStat({ label, part, whole, note }: { label: string; part: number; whole: number; note?: string }) {
  const pct = whole === 0 ? undefined : percent(Math.round(share(part, whole)));
  const small = whole > 0 && whole < SMALL_SAMPLE ? "Small Sample" : undefined;
  return <Stat label={label} value={of(part, whole)} note={[pct, small, note].filter(Boolean).join(", ") || undefined} />;
}

/** Number cards four up, two up on a phone. */
export function Stats({ children }: { children: ReactNode }) {
  return <div className="grid grid-cols-2 gap-3 md:grid-cols-4">{children}</div>;
}

/** The quiet line a card shows when it has nothing to list. */
export function Quiet({ children }: { children: ReactNode }) {
  return <p className="px-3 pb-3 text-sm text-muted-foreground">{children}</p>;
}

/** A card whose rows are still loading. */
export function LoadingCard({ title, rows = 2 }: { title?: string; rows?: number }) {
  return (
    <Card title={title}>
      <div className="flex flex-col gap-2 p-2" aria-busy="true" aria-label="Loading">
        {Array.from({ length: rows }, (_, i) => <Skeleton key={i} className="h-14 w-full rounded-lg" />)}
      </div>
    </Card>
  );
}

/** What a view shows while its first load runs: a row of number cards and a card, so nothing jumps when it arrives. */
export function LoadingCards() {
  return (
    <div className="flex flex-col gap-3" aria-busy="true" aria-label="Loading">
      <Stats>{Array.from({ length: 4 }, (_, i) => <Skeleton key={i} className="h-24 rounded-lg" />)}</Stats>
      <Skeleton className="h-48 w-full rounded-lg" />
    </div>
  );
}

/** A load that failed. With `onRetry` it offers to try again; otherwise the header Refresh does. */
export function Failed({ title, onRetry, busy = false }: { title: string; onRetry?: () => void; busy?: boolean }) {
  return (
    <Alert variant="destructive" className="bg-background">
      <AlertTitle>{title}</AlertTitle>
      <AlertDescription>Check your connection and try again.</AlertDescription>
      {onRetry && <AlertAction><Button variant="secondary" disabled={busy} onClick={onRetry}>Retry</Button></AlertAction>}
    </Alert>
  );
}

/** A card that starts closed: for the tables that earn their place only once there are enough people to read them. */
export function Advanced({ title = "Advanced", children }: { title?: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Card title={title} action={<Button type="button" variant="ghost" aria-expanded={open} onClick={() => setOpen((o) => !o)}>{open ? "Hide" : "Show"}</Button>}>
        {null}
      </Card>
      {open && children}
    </>
  );
}

const WORD: Record<Level, string> = { green: "OK", amber: "Slow", red: "Stuck" };
const DOT: Record<Level, string> = { green: "bg-emerald-500", amber: "bg-amber-500", red: "bg-destructive" };

/** A coloured dot and a word, so colour is never the only signal. The word can be replaced (a lease is "Expired", not "Stuck"). */
export function LevelMark({ level, word }: { level: Level; word?: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
      <span aria-hidden className={cn("size-2 rounded-full", DOT[level])} />
      {word ?? WORD[level]}
    </span>
  );
}

/** A 30 day line for one person; the label says what it is for people who cannot see it. */
export function Sparkline({ values, label, className }: { values: number[]; label: string; className?: string }) {
  return (
    <svg role="img" aria-label={label} viewBox="0 0 120 28" className={cn("h-7 w-24 text-foreground/65", className)} preserveAspectRatio="none">
      <path d={sparkPath(values, 120, 26)} transform="translate(0 1)" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}
