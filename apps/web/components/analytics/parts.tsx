"use client";

// Building blocks for the Analytics tabs: sections, tiles, tables, bars and the number, money and time formatters they share.

import { useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Table as UiTable, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import type { Stat } from "@messages/analytics/stats";

/** A titled block: a small heading, a muted line under it, then the content on a 12px rhythm. */
export function Section({ title, description, children }: { title: React.ReactNode; description?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="space-y-3">
      <div className="space-y-1">
        <h2 className="text-sm font-medium">{title}</h2>
        {description && <p className="text-xs text-muted-foreground">{description}</p>}
      </div>
      {children}
    </section>
  );
}

/** The sections of a tab: 12px apart, each after the first set off by a rule. */
export const SECTIONS = "flex flex-col gap-3 [&>section+section]:border-t [&>section+section]:pt-3";

const NAMES: Record<string, string> = {
  summary: "Summary",
  briefing: "Summary", // the Summary page's address before 27 October 2026
  inbox: "Inbox",
  calendar: "Calendar",
  contacts: "Contacts",
  attachments: "Attachments",
  settings: "Settings",
  home: "Home",
  login: "Sign In",
  whatsapp: "WhatsApp",
  icloud: "iCloud",
  gmail: "Gmail",
  outlook: "Outlook",
  ai: "AI",
  ms: "Milliseconds",
};

/** "needs_reply" as "Needs Reply", and the app's own names for its screens. */
export function nice(code: string): string {
  if (!code) return "None";
  return code
    .split(/[_:.-]+/)
    .filter(Boolean)
    .map((w) => NAMES[w] ?? w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

export const num = (n: number) => new Intl.NumberFormat("en-GB").format(Math.round(n * 10) / 10);
export const percent = (n: number) => `${num(n)}%`;
/** Dollars; under $1 keeps four decimals so a few cents of AI cost does not round to $0.00. */
export const money = (usd: number) => (usd === 0 ? "$0.00" : usd < 1 ? `$${usd.toFixed(4)}` : `$${usd.toFixed(2)}`);
export function seconds(s: number) {
  if (s < 60) return `${Math.round(s)}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m ${Math.round(s % 60)}s`;
  return `${Math.floor(s / 3600)}h ${Math.round((s % 3600) / 60)}m`;
}
/** Milliseconds, or seconds with one decimal from 1000 up. */
export const ms = (v: number) => (v >= 1000 ? `${(v / 1000).toFixed(1)}s` : `${Math.round(v)}ms`);
/** 12400 as "12.4k", for token counts. */
export const compact = (n: number) => new Intl.NumberFormat("en-GB", { notation: "compact", maximumFractionDigits: 1 }).format(n);

/** "2026-10-25" as "25 Oct". The day is a UTC date, so it is read as one. */
export function shortDay(iso: string): string {
  const d = new Date(`${iso.slice(0, 10)}T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
}

/** "3 of 10", or "No Data" when the whole is zero. */
export const of = (part: number, whole: number, fmt: (n: number) => string = num) => (whole === 0 ? "No Data" : `${fmt(part)} of ${fmt(whole)}`);
/** Part as a percentage of the whole; 0 when the whole is zero. */
export const share = (part: number, whole: number) => (whole === 0 ? 0 : (part / whole) * 100);

/** Below this many in the period before, a percentage change swings too wildly to mean anything, so counts are shown. */
const SMALL_BEFORE = 20;

/** The change from the period before, as plain words. No colour: a rise is not always good news. */
function change({ value, prev }: Stat, fmt?: (n: number) => string): string {
  if (value === prev) return "No Change";
  const up = value > prev;
  if (!fmt && prev < SMALL_BEFORE) return `${up ? "Up" : "Down"} From ${num(prev)} to ${num(value)}`;
  if (prev === 0) return "New";
  const d = Math.round(((value - prev) / prev) * 100);
  return d === 0 ? "No Change" : `${up ? "Up" : "Down"} ${Math.abs(d)}% On The Period Before`;
}

/** A figure with its label. `stat` adds the change from the period before (give `fmt` when it is not a plain count). */
export function Tile({ label, value, stat, note, fmt }: { label: string; value: string; stat?: Stat; note?: string; fmt?: (n: number) => string }) {
  return (
    <div className="rounded-lg border p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-1 text-2xl font-medium tabular-nums">{value}</div>
      {(stat || note) && <div className="mt-1 text-xs text-muted-foreground">{stat ? change(stat, fmt) : note}</div>}
    </div>
  );
}

/** Below this many, a percentage is a hint and not an answer: it is flagged wherever one is shown. */
export const SMALL_SAMPLE = 20;

/** A tile for a share: the count is the figure ("42 of 118") and the percentage is the note. A small sample is flagged. */
export function CountTile({ label, part, whole, note }: { label: string; part: number; whole: number; note?: string }) {
  const pct = whole === 0 ? undefined : percent(share(part, whole));
  const small = whole > 0 && whole < SMALL_SAMPLE ? "small sample" : undefined;
  return <Tile label={label} value={of(part, whole)} note={[pct, small, note].filter(Boolean).join(", ") || undefined} />;
}

export function Tiles({ children, three }: { children: React.ReactNode; three?: boolean }) {
  return <div className={cn("grid gap-3", three ? "grid-cols-1 sm:grid-cols-3" : "grid-cols-2 md:grid-cols-4")}>{children}</div>;
}

export function Note({ children }: { children: React.ReactNode }) {
  return <p className="rounded-lg border p-3 text-xs text-muted-foreground">{children}</p>;
}

/** A whole tab with nothing to show. */
export function EmptyState({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Empty className="border py-12">
      <EmptyHeader>
        <EmptyTitle>{title}</EmptyTitle>
        <EmptyDescription>{children}</EmptyDescription>
      </EmptyHeader>
    </Empty>
  );
}

/** One column of a table: its heading, how to draw a row's cell, and whether it is a number (right aligned). `wide` hides it on a phone. */
export interface Col<T> {
  head: string;
  cell: (row: T) => React.ReactNode;
  num?: boolean;
  wide?: boolean;
}

export function Table<T>({ cols, rows, empty = "No data yet.", max }: { cols: Col<T>[]; rows: T[]; empty?: string; max?: number }) {
  if (rows.length === 0) return <Note>{empty}</Note>;
  const cls = (c: Col<T>, i: number) => cn(c.wide && "hidden sm:table-cell", i === 0 && "sticky left-0 bg-background");
  return (
    <div className="rounded-lg border">
      <UiTable>
        <TableHeader>
          <TableRow>
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
    </div>
  );
}

/** A block that starts closed: for the tables that earn their place only once there are enough people to read them. */
export function Advanced({ title = "Advanced", children }: { title?: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <section className="space-y-3">
      <Button type="button" variant="ghost" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        {open ? `Hide ${title}` : `Show ${title}`}
      </Button>
      {open && <div className="flex flex-col gap-3">{children}</div>}
    </section>
  );
}

/** A share drawn as a thin bar beside its count ("12 of 40") and, under it, the percentage. */
export function Share({ part, whole, fmt }: { part: number; whole: number; fmt?: (n: number) => string }) {
  if (whole === 0) return <span className="whitespace-nowrap text-muted-foreground">No Data</span>;
  const pct = share(part, whole);
  return (
    <div className={cn("flex items-center justify-end gap-2 whitespace-nowrap", whole < SMALL_SAMPLE && "text-muted-foreground")} title={whole < SMALL_SAMPLE ? "Small sample" : undefined}>
      <div className="h-1.5 w-16 overflow-hidden rounded-full bg-muted" aria-hidden>
        <div className="h-full rounded-full bg-primary" style={{ width: `${Math.max(0, Math.min(100, pct))}%` }} />
      </div>
      <span className="min-w-20 text-right tabular-nums">
        {of(part, whole, fmt)} <span className="text-xs text-muted-foreground">{percent(Math.round(pct * 10) / 10)}</span>
      </span>
    </div>
  );
}

/**
 * One series over time as bars on a baseline, with the day under the pointer read out above. It is one stop for the
 * keyboard: the arrow keys move between days, Home and End go to the first and last, and a tap picks a day. The
 * numbers are also in a table for screen readers.
 */
export function Bars({ data, format = num, label }: { data: { label: string; value: number }[]; format?: (n: number) => string; label: string }) {
  const [active, setActive] = useState<number | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const last = data.length - 1;
  const max = Math.max(1, ...data.map((d) => d.value));

  if (data.length === 0 || data.every((d) => d.value === 0)) {
    return (
      <div className="rounded-lg border p-3">
        <div className="mb-3 text-xs text-muted-foreground">{label}</div>
        <EmptyState title="No Data">Nothing was recorded for this period.</EmptyState>
      </div>
    );
  }

  const shown = active === null ? null : data[active];
  const pick = (e: React.PointerEvent) => {
    const r = box.current?.getBoundingClientRect();
    if (!r || r.width === 0) return;
    setActive(Math.max(0, Math.min(last, Math.floor(((e.clientX - r.left) / r.width) * data.length))));
  };
  const key = (e: React.KeyboardEvent) => {
    const to = e.key === "ArrowRight" ? Math.min(last, (active ?? -1) + 1) : e.key === "ArrowLeft" ? Math.max(0, (active ?? data.length) - 1) : e.key === "Home" ? 0 : e.key === "End" ? last : e.key === "Escape" ? null : undefined;
    if (to === undefined) return;
    e.preventDefault();
    setActive(to);
  };

  return (
    <div className="rounded-lg border p-3">
      <div className="mb-3 flex h-5 items-center justify-between text-xs text-muted-foreground">
        <span>{label}</span>
        <span className="tabular-nums text-foreground" aria-live="polite">{shown ? `${shown.label}: ${format(shown.value)}` : ""}</span>
      </div>
      <div
        ref={box}
        role="group"
        aria-roledescription="chart"
        aria-label={`${label}, ${data.length} days. Use the left and right arrow keys to move between days.`}
        tabIndex={0}
        className="flex h-28 touch-pan-y items-end gap-0.5 rounded-sm border-b outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
        onPointerDown={pick}
        onPointerMove={(e) => (e.pointerType === "mouse" || e.buttons > 0) && pick(e)}
        onPointerLeave={(e) => e.pointerType === "mouse" && document.activeElement !== box.current && setActive(null)}
        onFocus={() => setActive((a) => a ?? last)}
        onBlur={() => setActive(null)}
        onKeyDown={key}
      >
        {data.map((d, i) => (
          <div key={d.label} className="flex h-full min-w-0 flex-1 items-end" aria-hidden>
            <div
              className={cn("w-full rounded-t-sm bg-primary", active !== null && active !== i && "opacity-40")}
              style={{ height: d.value === 0 ? 0 : `${Math.max(3, (d.value / max) * 100)}%` }}
            />
          </div>
        ))}
      </div>
      <div className="mt-1 flex justify-between text-xs text-muted-foreground">
        <span>{data[0]?.label}</span>
        <span className="tabular-nums">Tallest bar: {format(max)}</span>
        <span>{data.at(-1)?.label}</span>
      </div>
      {/* The hiding sits on a wrapper: browsers ignore sr-only's clip on a table, so its caption painted over the page. */}
      <div className="sr-only">
        <table>
          <caption>{label}</caption>
          <tbody>{data.map((d) => <tr key={d.label}><th scope="row">{d.label}</th><td>{format(d.value)}</td></tr>)}</tbody>
        </table>
      </div>
    </div>
  );
}

/** What shows while the first load runs: a row of tiles and a chart, so nothing jumps when it arrives. */
export function Loading() {
  return (
    <div className="flex flex-col gap-3" aria-busy="true" aria-label="Loading">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => <Skeleton key={i} className="h-24 rounded-lg" />)}
      </div>
      <Skeleton className="h-48 w-full rounded-lg" />
    </div>
  );
}
