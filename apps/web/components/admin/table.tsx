"use client";

// The table every Admin card uses, with no border of its own (the card is the frame), and a share drawn as a thin bar
// beside its count. Numbers are right aligned; columns marked `wide` hide on a phone.

import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { Table as UiTable, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { SMALL_SAMPLE, of, percent, share } from "./format";
import { Quiet } from "./parts";

/** One column of a table: its heading, how to draw a row's cell, and whether it is a number (right aligned). `wide` hides it on a phone. */
export interface Col<T> {
  head: string;
  cell: (row: T) => ReactNode;
  num?: boolean;
  wide?: boolean;
}

/** Rows as a table inside a card, or the card's quiet line when there are none. `max` shows the first that many. */
export function Table<T>({ cols, rows, empty = "No Data Yet", max }: { cols: Col<T>[]; rows: T[]; empty?: string; max?: number }) {
  if (rows.length === 0) return <Quiet>{empty}</Quiet>;
  const cls = (c: Col<T>, i: number) => cn(c.wide && "hidden sm:table-cell", i === 0 && "sticky left-0 bg-background");
  return (
    <UiTable>
      <TableHeader>
        <TableRow className="hover:bg-transparent">
          {cols.map((c, i) => (
            <TableHead key={c.head} scope="col" className={cn("px-3 text-xs font-normal text-muted-foreground", c.num && "text-right", cls(c, i))}>{c.head}</TableHead>
          ))}
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.slice(0, max ?? rows.length).map((r, i) => (
          <TableRow key={i} className="hover:bg-transparent">
            {cols.map((c, j) => (
              <TableCell key={c.head} className={cn("px-3 py-2", c.num && "text-right tabular-nums", cls(c, j))}>{c.cell(r)}</TableCell>
            ))}
          </TableRow>
        ))}
      </TableBody>
    </UiTable>
  );
}

/** A share drawn as a thin bar beside its count ("12 of 40") and the percentage. A small sample is quiet and says so on hover. */
export function Share({ part, whole, fmt }: { part: number; whole: number; fmt?: (n: number) => string }) {
  if (whole === 0) return <span className="whitespace-nowrap text-muted-foreground">No Data</span>;
  const pct = share(part, whole);
  return (
    <div className={cn("flex items-center justify-end gap-2 whitespace-nowrap", whole < SMALL_SAMPLE && "text-muted-foreground")} title={whole < SMALL_SAMPLE ? "Small Sample" : undefined}>
      <div className="h-1.5 w-16 overflow-hidden rounded-full bg-muted" aria-hidden>
        <div className="h-full rounded-full bg-foreground/65" style={{ width: `${Math.max(0, Math.min(100, pct))}%` }} />
      </div>
      <span className="min-w-20 text-right tabular-nums">
        {of(part, whole, fmt)} <span className="text-xs text-muted-foreground">{percent(Math.round(pct * 10) / 10)}</span>
      </span>
    </div>
  );
}
