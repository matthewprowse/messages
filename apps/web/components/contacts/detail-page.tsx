"use client";

// The frame of a contact or company page, laid out like an open conversation: a borderless 40px header (Back on
// phones, the avatar and name, icon actions) over the grey pane's column of cards. Also what it shows while loading,
// and the page for one that could not load. Re-exported from components/contact-list.tsx.

import Link from "next/link";
import { ArrowLeft, type Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/primitives";
import { PaneColumn } from "@/components/surface";

/** The header's who: a 40px avatar (or IconCircle), the name and a quiet line under it. */
export function DetailHeading({ avatar, title, subtitle }: { avatar?: React.ReactNode; title: string; subtitle?: string | null }) {
  return (
    <div className="flex h-10 min-w-0 flex-1 items-center gap-3">
      {avatar}
      <div className="min-w-0">
        <h1 className="truncate text-sm font-medium">{title}</h1>
        {subtitle && <div className="truncate text-xs text-muted-foreground">{subtitle}</div>}
      </div>
    </div>
  );
}

/** What a contact or company page shows while it loads: the header, the numbers and a card, in the same places. */
export function DetailSkeleton({ backHref }: { backHref: string }) {
  return (
    <DetailPage
      backHref={backHref}
      header={
        <div className="flex h-10 min-w-0 flex-1 items-center gap-3" role="status" aria-busy="true" aria-label="Loading">
          <Skeleton className="size-10 shrink-0 rounded-full" />
          <Skeleton className="h-5 w-40" />
        </div>
      }
    >
      <div className="grid grid-cols-3 gap-3">
        {[0, 1, 2].map((i) => <Skeleton key={i} className="h-[90px] rounded-lg" />)}
      </div>
      <Skeleton className="h-64 w-full rounded-lg" />
    </DetailPage>
  );
}

/** A page that could not load, as opposed to one that does not exist. */
export function LoadFailed({ icon, title, backHref, backLabel, onRetry }: { icon: typeof Users; title: string; backHref: string; backLabel: string; onRetry: () => void }) {
  return (
    <EmptyState
      icon={icon}
      title={title}
      action={
        <div className="flex items-center gap-2">
          <Button variant="secondary" asChild><Link href={backHref}>{backLabel}</Link></Button>
          <Button onClick={onRetry}>Retry</Button>
        </div>
      }
    />
  );
}

/** The right-hand page: the header, which stays put, and the cards scrolling under it on the grey. */
export function DetailPage({ backHref, header, children, className }: { backHref: string; header: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex shrink-0 items-center gap-2 p-3 md:px-4">
        <Button variant="ghost" size="icon" className="md:hidden" asChild aria-label="Back">
          <Link href={backHref}><ArrowLeft /></Link>
        </Button>
        {header}
      </header>
      <div className="min-h-0 flex-1">
        <PaneColumn className={className}>{children}</PaneColumn>
      </div>
    </div>
  );
}
