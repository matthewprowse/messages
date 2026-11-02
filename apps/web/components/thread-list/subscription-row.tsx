"use client";

// One company or sender in the Subscriptions view, laid out like a conversation row and opening its latest email.

import Link from "next/link";
import { Check, ExternalLink, MailX, type LucideIcon } from "lucide-react";
import type { Unsubscribe } from "@/lib/types";
import { withQuery } from "@/lib/thread-list";
import { rowStatus, type Sender } from "@/lib/subscription-senders";
import { cn } from "@/lib/utils";
import { Checkbox } from "@/components/ui/checkbox";
import { CompanyAvatar, ContactAvatar } from "@/components/primitives";
import { FADE } from "./fade";
import { RowButton } from "./row-button";

const UNSUBSCRIBE_LABEL: Record<Unsubscribe["status"], string> = {
  queued: "Unsubscribing",
  working: "Unsubscribing",
  done: "Unsubscribed",
  manual: "Confirm on Their Page",
  failed: "Could Not Unsubscribe",
};

/** One company or sender in Subscriptions: laid out like a conversation row, opening its latest email. */
export function SubscriptionRow({ sender, statuses, query, open, checked, selecting, pickable, onCheck, onUnsubscribe, onConfirm }: {
  sender: Sender;
  /** Each address's unsubscribe, in the order of sender.addresses. */
  statuses: (Unsubscribe | undefined)[];
  query: string;
  open: boolean;
  checked: boolean;
  selecting: boolean;
  pickable: boolean;
  onCheck: (key: string, range: boolean) => void;
  onUnsubscribe: (key: string) => void;
  onConfirm: (id: string) => void;
}) {
  const lit = open || checked;
  const status = rowStatus(statuses);
  // A sender left to confirm on their own page offers that page and a way to say it is done (for every
  // address of the company waiting on it); one that can still be unsubscribed from offers that. Others,
  // already on their way or done, offer nothing.
  const manual = statuses.filter((u): u is Unsubscribe => u?.status === "manual");
  const page = manual.find((u) => u.manualUrl)?.manualUrl;
  const actions: { label: string; icon: LucideIcon; onClick: () => void }[] = selecting ? [] : manual.length > 0 ? [
    ...(page ? [{ label: "Open Their Page", icon: ExternalLink, onClick: () => window.open(page, "_blank", "noopener,noreferrer") }] : []),
    { label: "Mark as Unsubscribed", icon: Check, onClick: () => manual.forEach((u) => onConfirm(u.id)) },
  ] : pickable ? [{ label: "Unsubscribe", icon: MailX, onClick: () => onUnsubscribe(sender.key) }] : [];
  const addresses = sender.addresses.length === 1 ? sender.addresses[0].address : `${sender.addresses.length} Addresses`;

  return (
    <div className={cn("group/row relative rounded-lg", lit ? "bg-muted" : "hover:bg-muted/50")}>
      <Link
        href={withQuery(`/inbox/${sender.latest.id}`, query)}
        data-row-link
        aria-current={open ? "page" : undefined}
        // Cmd or Ctrl-click checks one sender, Shift-click a range. Once any are checked, a click checks too.
        onClick={(e) => {
          if (!(e.shiftKey || e.metaKey || e.ctrlKey || selecting) || !pickable) return;
          e.preventDefault();
          onCheck(sender.key, e.shiftKey);
        }}
        className={cn("flex items-center gap-3 rounded-lg p-3 outline-none focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:ring-inset", actions.length > 0 && FADE[actions.length as 1 | 2])}
      >
        <div className={cn("shrink-0", lit && "[&_[data-slot=avatar-fallback]]:bg-background", pickable && (selecting ? "invisible" : "group-hover/row:invisible group-has-focus-visible/row:invisible group-focus-within/row:invisible pointer-coarse:invisible"))}>
          {sender.company ? (
            <CompanyAvatar logoPath={sender.company.logoPath} className="size-8" />
          ) : (
            <ContactAvatar contact={sender.contact} className="size-8" />
          )}
        </div>
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <div className="flex h-5 items-center justify-between gap-3">
            <span className="min-w-0 truncate text-sm font-medium">{sender.name}</span>
            <span data-hover-hide className="shrink-0 text-xs tabular-nums text-muted-foreground">{sender.count === 1 ? "1 Email" : `${sender.count} Emails`}</span>
          </div>
          <div className="flex h-4 items-center justify-between gap-3">
            <span className="min-w-0 truncate text-xs">{addresses}</span>
            {status && <span data-hover-hide className="shrink-0 text-xs text-muted-foreground">{UNSUBSCRIBE_LABEL[status.status]}</span>}
          </div>
        </div>
      </Link>
      {/* Over the avatar: shown on hover, and on every pickable row once one is checked. */}
      {pickable && (
        <div className={cn("absolute top-1/2 left-3 size-8 -translate-y-1/2 items-center justify-center", selecting ? "flex" : "hidden group-hover/row:flex group-has-focus-visible/row:flex group-focus-within/row:flex pointer-coarse:flex")}>
          <Checkbox
            checked={checked}
            aria-label={`Select ${sender.name}`}
            onClick={(e) => {
              e.preventDefault();
              onCheck(sender.key, e.shiftKey);
            }}
          />
        </div>
      )}
      {actions.length > 0 && (
        <div className="absolute top-1/2 right-3 hidden -translate-y-1/2 items-center gap-1 group-hover/row:flex group-focus-within/row:flex pointer-coarse:flex">
          {actions.map((a) => <RowButton key={a.label} variant="secondary" label={a.label} icon={a.icon} onClick={a.onClick} />)}
        </div>
      )}
    </div>
  );
}
