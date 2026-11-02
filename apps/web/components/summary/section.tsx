"use client";

// The Summary page's section frame: a sticky titled band over its rows, and a row list with rules between rows.

import { Children, Fragment, isValidElement } from "react";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";

// A band like the search box in Conversations: padded, and separated below (the first section always, the rest once stuck). It sticks under
// the header while its section scrolls, and the next section's band pushes it up. Each section after the first
// has its own space above its band, so while the band above is still stuck there is room under its separator.
export function Section({ title, count, separated = false, children }: { title: string; count?: number; separated?: boolean; children: React.ReactNode }) {
  return (
    <section className="not-first:pt-3 last:pb-3" aria-label={title}>
      <h2
        data-band
        className={cn(
          "sticky top-(--summary-header) z-[5] -mx-3 flex items-center gap-2 border-b bg-background p-3 text-sm font-medium",
          separated ? "border-border" : "border-transparent data-stuck:border-border",
        )}
      >
        <span className="flex h-8 items-center gap-2">
          {title}
          {count !== undefined && <Badge variant="secondary">{count}</Badge>}
        </span>
      </h2>
      <div className="pt-3">{children}</div>
    </section>
  );
}

/** Rows with a rule between each, inset past the avatar. Children keep their own keys. */
export function Separated({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
      {Children.toArray(children).map((child, i) => (
        <Fragment key={isValidElement(child) ? child.key : i}>
          {i > 0 && <div className="pl-14"><Separator /></div>}
          {child}
        </Fragment>
      ))}
    </div>
  );
}
