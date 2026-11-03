"use client";

// What the Calendar's list shows when it has nothing to list: connect an account first, connect a calendar, or nothing
// is scheduled in the days on show (with New Event once a calendar is connected).

import Link from "next/link";
import { CalendarDays } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/primitives";

export type CalendarEmptyKind = "no_accounts" | "no_calendar" | "no_events";

/** `onNewEvent` is left out while no calendar is connected, as there is nowhere to create one. */
export function CalendarEmpty({ kind, onNewEvent }: { kind: CalendarEmptyKind; onNewEvent?: () => void }) {
  return (
    <div className="py-24">
      {kind === "no_accounts" ? (
        <EmptyState icon={CalendarDays} title="Connect an Account" action={<Button asChild><Link href="/settings/accounts">Connect an Account</Link></Button>} />
      ) : kind === "no_calendar" ? (
        <EmptyState icon={CalendarDays} title="Connect a Calendar" action={<Button variant="secondary" asChild><Link href="/settings/accounts">Connected Accounts</Link></Button>} />
      ) : (
        <EmptyState icon={CalendarDays} title="No Events" action={onNewEvent && <Button variant="secondary" onClick={onNewEvent}>New Event</Button>} />
      )}
    </div>
  );
}
