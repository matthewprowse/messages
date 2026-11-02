"use client";

// Small pieces the operator sections share: the red, amber and green mark (always with a word, so colour is never the only
// signal) and a tiny spend sparkline.

import { cn } from "@/lib/utils";
import { sparkPath, type Level } from "@/lib/admin-ops";

const WORD: Record<Level, string> = { green: "OK", amber: "Slow", red: "Stuck" };
const DOT: Record<Level, string> = { green: "bg-emerald-500", amber: "bg-amber-500", red: "bg-destructive" };

/** A coloured dot and a word. The word can be replaced (a lease is "Expired", not "Stuck"). */
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
    <svg role="img" aria-label={label} viewBox="0 0 120 28" className={cn("h-7 w-30 text-foreground/70", className)} preserveAspectRatio="none">
      <path d={sparkPath(values, 120, 26)} transform="translate(0 1)" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}
