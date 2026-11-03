"use client";

// A notice above the Summary when an account has stopped syncing, so "All Caught Up" is not read as the whole truth.
// Its own row at the top of the list: one line of text and Reconnect, with a rule under it across the column.

import Link from "next/link";
import { Button } from "@/components/ui/button";

export function AccountsNotice({ count }: { count: number }) {
  return (
    <div role="alert" className="-mx-3 flex items-center justify-between gap-3 border-b p-3">
      <span className="min-w-0 truncate text-sm font-medium">{count === 1 ? "1 Account Not Syncing" : `${count} Accounts Not Syncing`}</span>
      <Button asChild variant="secondary"><Link href="/settings/accounts">Reconnect</Link></Button>
    </div>
  );
}
