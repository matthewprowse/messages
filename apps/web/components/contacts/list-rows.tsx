"use client";

// Row building blocks shared by the Contacts list and the contact and company pages: list rows, label and value rows,
// and a page's conversation rows. Re-exported from components/contact-list.tsx.

import { Children, Fragment, isValidElement, useState } from "react";
import Link from "next/link";
import type { ContactConversation } from "@/lib/contacts";
import type { Provider } from "@/lib/types";
import { relTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { ProviderBadge } from "@/components/provider-logo";
import { Row, Separated } from "@/components/surface";

/** Children with a full width separator between each, for a bordered box of rows such as Split's. */
export function Divided({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <>
      {Children.toArray(children).map((child, i) => (
        <Fragment key={isValidElement(child) && child.key != null ? child.key : i}>
          {i > 0 && (className ? <div className={className}><Separator /></div> : <Separator />)}
          {child}
        </Fragment>
      ))}
    </>
  );
}

/** A 40px avatar with the service's badge on its corner, as on a conversation row. */
export function BadgedAvatar({ avatar, provider }: { avatar: React.ReactNode; provider?: Provider }) {
  return (
    <span className="relative shrink-0">
      {avatar}
      <ProviderBadge provider={provider} />
    </span>
  );
}

/** A row as in the Conversations list: a 40px avatar, a name line and a detail line. */
export function ListRow({
  href,
  avatar,
  provider,
  title,
  badge,
  at,
  detail,
  unread = 0,
  selected = false,
}: {
  href: string;
  avatar?: React.ReactNode;
  /** Their main channel, as a badge on the avatar. */
  provider?: Provider;
  title: string;
  /** Shown just after the title, such as the star. */
  badge?: React.ReactNode;
  /** Shown on the right as a relative time. */
  at?: string | null;
  /** Leave undefined for no detail line; an empty string keeps the row's height. */
  detail?: string;
  /** Unread messages, as a count under the time like an Inbox row. */
  unread?: number;
  selected?: boolean;
}) {
  return (
    <Link
      href={href}
      aria-current={selected ? "page" : undefined}
      className={cn("flex items-center gap-3 rounded-lg p-3 outline-none focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:ring-inset", selected ? "bg-muted" : "hover:bg-muted/50")}
    >
      {avatar && <div className={cn("shrink-0", selected && "[&_[data-slot=avatar-fallback]]:bg-background")}><BadgedAvatar avatar={avatar} provider={provider} /></div>}
      {/* 20px name line + 4px gap + 16px detail line = 40px, the avatar's height. */}
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex h-5 items-center justify-between gap-3">
          <span className="flex min-w-0 items-center gap-1.5">
            <span className="min-w-0 truncate text-sm font-medium">{title}</span>
            {badge}
          </span>
          {at && <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{relTime(at, new Date())}</span>}
        </div>
        {detail !== undefined && (
          <div className="flex h-4 items-center justify-between gap-3">
            <span className="min-w-0 truncate text-xs text-muted-foreground">{detail}</span>
            {/* The Inbox row's unread chip (thread-list/thread-row.tsx), so the two lists read the same. */}
            {unread > 0 && (
              <span className={cn("-my-0.5 flex size-5 shrink-0 items-center justify-center rounded-full text-xs font-medium", selected ? "bg-background" : "bg-muted")} aria-label={`${unread} unread`}>
                {unread}
              </span>
            )}
          </div>
        )}
      </div>
    </Link>
  );
}

/** Label and value rows inside a card, a rule between each, as on a contact's page. */
export function DetailList({ items }: { items: { label: string; value: string; href?: string; onSelect?: () => void }[] }) {
  const valueClass = "min-w-0 truncate text-sm underline-offset-2 hover:underline";
  return (
    <Separated inset="none">
      {items.map((d) => (
        <div key={`${d.label}-${d.value}`} className="flex min-h-10 items-center justify-between gap-6 px-3">
          <span className="shrink-0 text-sm text-muted-foreground">{d.label}</span>
          {d.href ? (
            <Link href={d.href} title={d.value} className={valueClass}>{d.value}</Link>
          ) : d.onSelect ? (
            <button type="button" title={d.value} onClick={d.onSelect} className={cn(valueClass, "rounded-sm text-right outline-none focus-visible:ring-2 focus-visible:ring-ring/50")}>{d.value}</button>
          ) : (
            <span title={d.value} className="min-w-0 truncate text-sm">{d.value}</span>
          )}
        </div>
      ))}
    </Separated>
  );
}

/** How many conversations a contact's or company's card lists at first, a glance like the empty pane's; Show More adds twice as many. */
const CONVERSATION_PAGE = 5;

/** Conversations in a card on a contact's or a company's page: their photo with the service as a badge, as on the empty Conversations page. */
export function ConversationRows({ items, avatar }: { items: Pick<ContactConversation, "id" | "provider" | "title" | "preview" | "lastAt">[]; avatar: React.ReactNode }) {
  const [shown, setShown] = useState(CONVERSATION_PAGE);
  return (
    <>
      <Separated>
        {items.slice(0, shown).map((t) => (
          <Row
            key={t.id}
            href={`/inbox/${t.id}`}
            lead={<BadgedAvatar avatar={avatar} provider={t.provider} />}
            title={t.title}
            meta={t.lastAt ? relTime(t.lastAt) : undefined}
            detail={t.preview || undefined}
          />
        ))}
      </Separated>
      {items.length > shown && (
        <Button variant="ghost" className="m-2 text-muted-foreground" onClick={() => setShown((n) => n + CONVERSATION_PAGE * 2)}>Show More</Button>
      )}
    </>
  );
}
