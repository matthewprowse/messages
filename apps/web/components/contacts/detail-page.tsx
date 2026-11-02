"use client";

// The frame of a contact or company page (sticky header, Back on phones), what it shows while loading, and the
// page for one that could not load. Re-exported from components/contact-list.tsx.

import Link from "next/link";
import { ArrowLeft, type Users } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/primitives";

/** What a contact or company page shows while it loads: the header and a few rows, in the same places. */
export function DetailSkeleton({ backHref }: { backHref: string }) {
  return (
    <DetailPage
      backHref={backHref}
      header={
        <div className="flex min-w-0 flex-1 items-center gap-3" role="status" aria-busy="true" aria-label="Loading">
          <Skeleton className="size-8 shrink-0 rounded-full" />
          <Skeleton className="h-5 w-40" />
        </div>
      }
    >
      <Skeleton className="h-4 w-full" />
      <Skeleton className="h-28 w-full rounded-lg" />
      <div className="flex flex-col gap-2">
        {Array.from({ length: 4 }, (_, i) => (
          <div key={i} className="flex items-center gap-3 py-3">
            <Skeleton className="size-8 shrink-0 rounded-full" />
            <div className="flex flex-1 flex-col gap-1">
              <Skeleton className="h-5 w-2/3" />
              <Skeleton className="h-4 w-5/6" />
            </div>
          </div>
        ))}
      </div>
    </DetailPage>
  );
}

/** A page that could not load, as opposed to one that does not exist. */
export function LoadFailed({ icon, title, backHref, backLabel, onRetry }: { icon: typeof Users; title: string; backHref: string; backLabel: string; onRetry: () => void }) {
  return (
    <EmptyState
      icon={icon}
      title={title}
      description="Check your connection, then try again."
      action={
        <div className="flex items-center gap-2">
          <Button variant="secondary" asChild><Link href={backHref}>{backLabel}</Link></Button>
          <Button onClick={onRetry}>Retry</Button>
        </div>
      }
    />
  );
}

/** The right-hand page: a header that sticks to the scroll area, with Back on phones, and content under it. */
export function DetailPage({ backHref, header, children, className = "space-y-8" }: { backHref: string; header: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    // Solid, with a line under it, like the Summary and Conversations headers; the scrollbar starts below it.
    <ScrollArea className="h-full" scrollbarClassName="data-vertical:top-[65px]! data-vertical:h-auto!">
      <header className="sticky top-0 z-10 flex items-center gap-2 border-b bg-background p-3 md:px-4">
        <Button variant="ghost" size="icon" className="md:hidden" asChild aria-label="Back">
          <Link href={backHref}><ArrowLeft /></Link>
        </Button>
        {header}
      </header>
      <div className="p-3 md:px-4">
        <div className={cn("mx-auto w-full max-w-2xl", className)}>{children}</div>
      </div>
    </ScrollArea>
  );
}
