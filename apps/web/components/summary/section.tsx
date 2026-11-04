"use client";

// The Summary page's section frame: a sticky titled band over its rows. Rows with rules between them are the shared Separated.

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

/**
 * True once the band has scrolled away from its place at the top of its section. A 1px sentinel sits where the band
 * rests; when it leaves through the top of the scroll area (below the sticky header) the band has stuck. An
 * IntersectionObserver reports that, so scrolling never reads layout.
 */
function useStuck(headerHeight: number) {
  const sentinel = useRef<HTMLDivElement>(null);
  const [stuck, setStuck] = useState(false);
  useEffect(() => {
    const el = sentinel.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      ([entry]) => setStuck(!entry.isIntersecting && entry.boundingClientRect.top < (entry.rootBounds?.top ?? 0)),
      { root: el.closest<HTMLElement>("[data-slot=scroll-area-viewport]"), rootMargin: `-${Math.round(headerHeight)}px 0px 0px 0px` },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [headerHeight]);
  return { sentinel, stuck };
}

// A band like the search box in Conversations: padded, and separated below (the first section always, the rest once stuck). It sticks under
// the header while its section scrolls, and the next section's band pushes it up. Each section after the first
// has its own space above its band, so while the band above is still stuck there is room under its separator.
export function Section({ title, count, separated = false, headerHeight, action, children }: { title: string; count?: number; separated?: boolean; headerHeight: number; action?: { label: string; href: string }; children: React.ReactNode }) {
  const { sentinel, stuck } = useStuck(headerHeight);
  return (
    <section className="not-first:pt-3 last:pb-3" aria-label={title}>
      <div ref={sentinel} aria-hidden className="-mb-px h-px" />
      <h2
        data-band
        data-stuck={stuck ? "" : undefined}
        className={cn(
          "sticky top-(--summary-header) z-[5] -mx-3 flex items-center justify-between gap-2 border-b bg-background p-3 text-sm font-medium",
          separated ? "border-border" : "border-transparent data-stuck:border-border",
        )}
      >
        <span className="flex h-8 items-center gap-2">
          {title}
          {count !== undefined && <Badge variant="secondary">{count}</Badge>}
        </span>
        {action && <Button asChild variant="ghost"><Link href={action.href}>{action.label}</Link></Button>}
      </h2>
      <div className="pt-3">{children}</div>
    </section>
  );
}

export { Separated } from "@/components/surface";
