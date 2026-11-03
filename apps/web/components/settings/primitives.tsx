"use client";

// The building blocks every Settings card is made of: a section is a white Card (components/surface.tsx), and inside a card a
// section is a titled group. Rows are a title, an optional live detail line (an address, "Last synced 2m") and the control at
// the end, with a rule between each. No state and no data, so any settings component can use them. The connect components
// outside Settings (whatsapp-link, linkedin-connect, instagram-setup...) still pass descriptions, so those still render.

import { createContext, useContext } from "react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { Card, Separated } from "@/components/surface";

// True inside a card, so a section there is a group in it rather than a second card.
const InCard = createContext(false);

/** A group's title. Level 3 is a group in a card, level 4 a quieter label over a few rows (an account's name). */
export function SettingsHeading({ title, description, level = 3 }: { title: React.ReactNode; description?: React.ReactNode; level?: 2 | 3 | 4 }) {
  const Tag = `h${level}` as const;
  return (
    <div>
      <Tag className={cn("flex items-center", level === 4 ? "h-8 text-xs text-muted-foreground" : "h-10 text-sm font-medium")}>{title}</Tag>
      {description && <div className="pb-2 text-sm text-muted-foreground">{description}</div>}
    </div>
  );
}

/** A card of settings, or inside one a titled group. `id` is what search and links scroll to; `action` sits in the title row. */
export function SettingsSection({ id, title, description, action, level, children }: { id?: string; title?: React.ReactNode; description?: React.ReactNode; action?: React.ReactNode; level?: 2 | 3 | 4; children: React.ReactNode }) {
  const inCard = useContext(InCard);
  if (!inCard && (level ?? 2) === 2) {
    return (
      <Card id={id} title={title} action={action}>
        <InCard.Provider value>
          {description && <p className="px-3 pb-2 text-sm text-muted-foreground">{description}</p>}
          <div className="flex flex-col">{children}</div>
        </InCard.Provider>
      </Card>
    );
  }
  return (
    <section id={id} className="flex scroll-mt-3 flex-col not-first:mt-2">
      {title && <div className="flex items-center justify-between gap-3 px-3"><SettingsHeading title={title} description={description} level={level === 4 ? 4 : 3} />{action}</div>}
      {children}
    </section>
  );
}

/** Text, forms and buttons in a card, set in to line up with the rows' text. */
export function SettingsBody({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn("flex flex-col gap-3 p-3", className)}>{children}</div>;
}

/** Rows with a rule between each, inset past a 40px lead when the rows have one. */
export function SettingsRows({ children, inset = "none" }: { children: React.ReactNode; inset?: "lead" | "none" }) {
  return <Separated inset={inset}>{children}</Separated>;
}

/**
 * One row: an optional lead, the title, an optional detail line under it (live data only) and the controls at the end, which
 * wrap under the text when the row is narrow so a long title is never squashed. A row with `href` is a link.
 */
export function SettingsRow({ title, description, leading, href, children }: { title: React.ReactNode; description?: React.ReactNode; leading?: React.ReactNode; href?: string; children?: React.ReactNode }) {
  const body = (
    <>
      <div className="flex min-w-[12rem] flex-1 items-center gap-3">
        {leading}
        <div className="min-w-0 flex-1">
          <div className="flex min-h-5 flex-wrap items-center gap-2 text-sm font-medium">{title}</div>
          {description && <div className="mt-1 text-xs text-muted-foreground">{description}</div>}
        </div>
      </div>
      {children && <div className="flex shrink-0 flex-wrap items-center gap-2">{children}</div>}
    </>
  );
  const className = "flex flex-wrap items-center gap-3 rounded-lg p-3";
  return href ? <Link href={href} className={cn(className, "outline-none hover:bg-muted/50 focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:ring-inset")}>{body}</Link> : <div className={className}>{body}</div>;
}

/** The line shown in place of an empty list. */
export function SettingsEmpty({ children }: { children: React.ReactNode }) {
  return <p className="p-3 text-sm text-muted-foreground">{children}</p>;
}
