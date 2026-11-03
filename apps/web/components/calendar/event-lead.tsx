"use client";

// The 40px leading circle of an event row, with the logo of the calendar it is in (Google, Outlook or iCloud) on its
// corner, the way a conversation row carries its channel.

import { CalendarDays } from "lucide-react";
import type { Provider } from "@/lib/types";
import { ProviderBadge } from "@/components/provider-logo";
import { IconCircle } from "@/components/surface";

/** The circle alone while the account is unknown, such as an event still being created. */
export function EventLead({ provider }: { provider: Provider | undefined }) {
  return (
    <span className="relative shrink-0">
      <IconCircle icon={CalendarDays} />
      <ProviderBadge provider={provider} />
    </span>
  );
}
