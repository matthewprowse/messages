"use client";

// The Summary's "Older" row: conversations still waiting on you that have aged out of the page's time windows. They
// stay off the list but never vanish without a trace; the row leads to the Inbox where they can be dealt with.

import Link from "next/link";
import { History } from "lucide-react";
import { OLDER_HREF } from "@/lib/summary-list";

export function OlderRow({ count }: { count: number }) {
  return (
    <Link
      href={OLDER_HREF}
      className="flex items-center gap-3 rounded-lg p-3 outline-none hover:bg-muted/50 focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:ring-inset"
    >
      <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-muted">
        <History className="size-4" />
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="min-w-0 truncate text-sm font-medium">{count} Older {count === 1 ? "Conversation" : "Conversations"} Waiting on You</span>
        <span className="min-w-0 truncate text-xs">Quiet for a while. Open them in Priority.</span>
      </div>
    </Link>
  );
}
