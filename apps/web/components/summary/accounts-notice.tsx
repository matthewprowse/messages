"use client";

// A notice above the Summary when an account has stopped syncing, so "All Caught Up" is not read as the whole truth.

import Link from "next/link";
import { TriangleAlert } from "lucide-react";
import { Alert, AlertAction, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";

export function AccountsNotice({ count }: { count: number }) {
  return (
    <Alert className="mt-3">
      <TriangleAlert />
      <AlertTitle>{count === 1 ? "An Account Is Not Syncing" : `${count} Accounts Are Not Syncing`}</AlertTitle>
      <AlertDescription>New messages from {count === 1 ? "it" : "them"} will not appear here until {count === 1 ? "it is" : "they are"} reconnected.</AlertDescription>
      <AlertAction>
        <Button asChild variant="secondary" size="sm"><Link href="/settings/accounts">Reconnect</Link></Button>
      </AlertAction>
    </Alert>
  );
}
