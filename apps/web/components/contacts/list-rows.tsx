"use client";

// Row building blocks shared by the Contacts list and the contact and company pages: separators, list rows, detail
// lists, and a page's conversation rows. Re-exported from components/contact-list.tsx.

import { Children, Fragment, isValidElement, useState } from "react";
import Link from "next/link";
import type { ContactConversation } from "@/lib/contacts";
import { relTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { ProviderLogo } from "@/components/provider-logo";

/** Children with a separator between each, inset to line up with the text when className says so. */
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

/** A row as in the Conversations list: an optional avatar, a name line and a detail line. */
export function ListRow({
  href,
  avatar,
  title,
  badge,
  at,
  aside,
  detail,
  unread = 0,
  selected = false,
  className,
}: {
  href: string;
  avatar?: React.ReactNode;
  title: string;
  /** Shown just after the title, such as the service a conversation comes from. */
  badge?: React.ReactNode;
  /** Shown on the right as a relative time. */
  at?: string | null;
  /** Shown on the right instead of a time. */
  aside?: React.ReactNode;
  /** Leave undefined for no detail line; an empty string keeps the row's height. */
  detail?: string;
  /** Unread messages, as a count under the time like an Inbox row. */
  unread?: number;
  selected?: boolean;
  className?: string;
}) {
  return (
    <Link
      href={href}
      aria-current={selected ? "page" : undefined}
      className={cn("flex items-center gap-3 rounded-lg p-3 outline-none focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:ring-inset", selected ? "bg-muted" : "hover:bg-muted/50", className)}
    >
      {avatar && <div className={cn("shrink-0", selected && "[&_[data-slot=avatar-fallback]]:bg-background")}>{avatar}</div>}
      {/* 20px name line + 4px gap + 16px detail line = 40px, the row's height. */}
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex h-5 items-center justify-between gap-3">
          <span className="flex min-w-0 items-center gap-1.5">
            <span className="min-w-0 truncate text-sm font-medium">{title}</span>
            {badge}
          </span>
          {aside ?? (at && <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{relTime(at, new Date())}</span>)}
        </div>
        {detail !== undefined && (
          <div className="flex h-4 items-center justify-between gap-3">
            <span className="min-w-0 truncate text-xs">{detail}</span>
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

export function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-2">
      <h2 className="text-sm font-medium">{title}</h2>
      {children}
    </section>
  );
}

/** Label and value rows in a bordered box, as on a contact's and a company's page. */
export function DetailList({ items }: { items: { label: string; value: string; href?: string; onSelect?: () => void }[] }) {
  const valueClass = "min-w-0 truncate text-sm underline-offset-2 hover:underline";
  return (
    <div className="rounded-lg border px-4">
      <Divided>
        {items.map((d) => (
          <div key={`${d.label}-${d.value}`} className="flex items-center justify-between gap-6 py-3">
            <span className="shrink-0 text-xs text-muted-foreground">{d.label}</span>
            {d.href ? (
              <Link href={d.href} title={d.value} className={valueClass}>{d.value}</Link>
            ) : d.onSelect ? (
              <button type="button" title={d.value} onClick={d.onSelect} className={cn(valueClass, "rounded-sm text-right outline-none focus-visible:ring-2 focus-visible:ring-ring/50")}>{d.value}</button>
            ) : (
              <span title={d.value} className="min-w-0 truncate text-sm">{d.value}</span>
            )}
          </div>
        ))}
      </Divided>
    </div>
  );
}

/** How many conversations a contact's or company's page lists at first, and each Show More adds. */
const CONVERSATION_PAGE = 10;

/** Conversations on a contact's or a company's page: one row style, with their photo and the service as a badge. */
export function ConversationRows({ items, avatar }: { items: Pick<ContactConversation, "id" | "provider" | "title" | "preview" | "lastAt">[]; avatar: React.ReactNode }) {
  const [shown, setShown] = useState(CONVERSATION_PAGE);
  return (
    <div className="-mx-3 flex flex-col gap-2">
      <Divided className="pr-3 pl-14">
        {items.slice(0, shown).map((t) => (
          <ListRow key={t.id} href={`/inbox/${t.id}`} avatar={avatar} title={t.title} badge={<ProviderLogo provider={t.provider} />} at={t.lastAt} detail={t.preview ?? ""} />
        ))}
      </Divided>
      {items.length > shown && (
        <div className="px-3">
          <Button variant="secondary" onClick={() => setShown((n) => n + CONVERSATION_PAGE)}>Show More ({items.length - shown})</Button>
        </div>
      )}
    </div>
  );
}
