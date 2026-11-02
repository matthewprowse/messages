"use client";

// What the Summary page shows when nothing needs you: connect an account, a first import under way, or all caught up.
// Also the placeholder rows shown while conversations load.

import Link from "next/link";
import { CircleCheck, Link2, RefreshCw } from "lucide-react";
import type { ListFilter } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/primitives";

/** The placeholder rows shown while conversations load. */
export function LoadingSummary() {
  return (
    <div role="status" aria-busy="true" className="flex flex-col gap-2 pb-3" aria-label="Loading summary">
      {/* A band, like the real sections, so the page does not jump when they arrive. */}
      <div className="-mx-3 flex items-center border-b p-3"><Skeleton className="h-8 w-32" /></div>
      {Array.from({ length: 8 }, (_, i) => (
        <div key={i} className="flex items-center gap-3 p-3">
          <Skeleton className="size-8 shrink-0 rounded-full" />
          <div className="flex flex-1 flex-col gap-1">
            <Skeleton className="h-5 w-2/3" />
            <Skeleton className="h-4 w-5/6" />
          </div>
        </div>
      ))}
    </div>
  );
}

export function SummaryEmpty({ noAccounts, importing, filter, onClearFilter }: { noAccounts: boolean; importing: boolean; filter: ListFilter; onClearFilter: () => void }) {
  if (noAccounts) {
    return (
      <div className="py-24">
        <EmptyState
          icon={Link2}
          title="Connect an Account"
          description="Connect Gmail, WhatsApp or iCloud to see what needs you here."
          action={<Button asChild><Link href="/settings/accounts">Connect an Account</Link></Button>}
        />
      </div>
    );
  }
  if (importing && filter === "none") {
    return (
      <div className="py-24">
        <EmptyState icon={RefreshCw} title="Importing Your Messages" description="What needs you appears here as your messages arrive. The first import can take a few minutes." />
      </div>
    );
  }
  return (
    <div className="py-24">
      <EmptyState
        icon={CircleCheck}
        title="You're All Caught Up"
        description={filter === "none" ? "Replies waiting on you, urgent conversations, today's events and tasks appear here." : filter === "waiting" ? "Nothing you wrote has gone 2 days without an answer." : "Nothing that needs you matches this filter."}
        action={filter !== "none" ? <Button variant="secondary" onClick={onClearFilter}>Clear Filter</Button> : undefined}
      />
    </div>
  );
}
