"use client";

// The shared parts every redesigned page is built from, taken from Conversations and Summary so the pages stay the same:
// the grey main pane's scrolling column, a white card with a 40px title row, a number card, a 40px icon circle, a row with
// a 40px leading slot, and rows with a rule between each inset past that slot.

import { Children, Fragment, isValidElement, type ReactNode } from "react";
import Link from "next/link";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";

const WIDTH = { "2xl": "max-w-2xl", "5xl": "max-w-5xl", full: "max-w-none" } as const;

/**
 * The grey pane's content: a centred column of cards, 4px apart from the gutters, scrolling on its own. `center` puts a
 * short page in the middle (as the empty Conversations page does) and still scrolls from the top once it is long.
 * The grey itself is the layout's section (bg-muted/50); a page with no layout split passes `grey`.
 */
export function PaneColumn({ children, width = "2xl", center = false, grey = false, className }: { children: ReactNode; width?: keyof typeof WIDTH; center?: boolean; grey?: boolean; className?: string }) {
  return (
    // Never sideways: a long subject or an unbroken link inside a card truncates or wraps instead of widening the column.
    <div className={cn("h-full overflow-x-hidden overflow-y-auto", grey && "bg-muted/50")}>
      <div className="flex min-h-full justify-center p-3 md:p-6">
        <div className={cn("flex w-full min-w-0 flex-col gap-3", WIDTH[width], center && "my-auto", className)}>{children}</div>
      </div>
    </div>
  );
}

/** A white card with a 40px title row: the title, quiet, on the left; an action or See All on the right. */
export function Card({ title, action, href, hrefLabel = "See All", id, className, children }: { title?: ReactNode; action?: ReactNode; href?: string; hrefLabel?: string; id?: string; className?: string; children: ReactNode }) {
  return (
    <section id={id} aria-label={typeof title === "string" ? title : undefined} className={cn("relative min-w-0 scroll-mt-3 rounded-lg border bg-background p-1 break-words", className)}>
      {(title || action || href) && (
        <div className="flex h-10 items-center justify-between gap-3 px-3">
          <h2 className="min-w-0 truncate text-sm text-muted-foreground">{title}</h2>
          {action ?? (href && <Link href={href} className="shrink-0 rounded-sm text-sm text-muted-foreground outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50">{hrefLabel}</Link>)}
        </div>
      )}
      {children}
    </section>
  );
}

/** A number in a card with its label above it. Undefined is still loading. */
export function StatCard({ label, value }: { label: string; value: ReactNode | undefined }) {
  return (
    <div className="flex flex-col gap-1 rounded-lg border bg-background p-4">
      <span className="truncate text-sm text-muted-foreground" title={label}>{label}</span>
      {value === undefined ? <Skeleton className="h-8 w-10" /> : <span className="text-2xl font-medium tabular-nums">{value}</span>}
    </div>
  );
}

/** A 40px grey tile with an icon, where a row has no avatar: rounded like the rail's icon buttons, since only people are round. */
export function IconCircle({ icon: Icon, className }: { icon: LucideIcon; className?: string }) {
  return (
    <span aria-hidden className={cn("flex size-10 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground", className)}>
      <Icon className="size-4" />
    </span>
  );
}

/**
 * A row laid out like a conversation row: a 40px leading slot (avatar or IconCircle), a 20px title line and a 16px detail
 * line, a quiet meta on the right of the title and anything else (a control, a button) at the end. A link with `href`,
 * a button with `onClick`, otherwise plain.
 */
export function Row({ lead, title, detail, meta, end, href, onClick, active = false, className }: { lead?: ReactNode; title: ReactNode; detail?: ReactNode; meta?: ReactNode; end?: ReactNode; href?: string; onClick?: () => void; active?: boolean; className?: string }) {
  const body = (
    <>
      {lead}
      <span className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="flex h-5 items-center justify-between gap-3">
          <span className="min-w-0 truncate text-sm font-medium">{title}</span>
          {meta && <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{meta}</span>}
        </span>
        {detail && <span className="flex h-4 items-center"><span className="min-w-0 truncate text-xs text-muted-foreground">{detail}</span></span>}
      </span>
    </>
  );
  const cls = cn("flex min-w-0 flex-1 items-center gap-3 text-left outline-none", (href || onClick) && "focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:ring-inset");
  return (
    <div className={cn("flex items-center gap-3 rounded-lg p-3", (href || onClick) && "hover:bg-muted/50", active && "bg-muted", className)}>
      {href ? <Link href={href} className={cls}>{body}</Link> : onClick ? <button type="button" onClick={onClick} className={cls}>{body}</button> : <div className={cls}>{body}</div>}
      {end && <div className="flex shrink-0 items-center gap-1">{end}</div>}
    </div>
  );
}

/** Rows with a rule between each, inset past the 40px leading slot (`inset="lead"`) or the row's padding. Children keep their keys. */
export function Separated({ children, inset = "lead" }: { children: ReactNode; inset?: "lead" | "none" }) {
  return (
    <div className="flex flex-col gap-2">
      {Children.toArray(children).map((child, i) => (
        <Fragment key={isValidElement(child) ? child.key : i}>
          {i > 0 && <div className={inset === "lead" ? "pl-16" : "px-3"}><Separator /></div>}
          {child}
        </Fragment>
      ))}
    </div>
  );
}
