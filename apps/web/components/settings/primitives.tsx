// The building blocks every Settings page is made of: headings, sections and the one row style (a title and
// description with any controls on the right). No state and no data, so any settings component can use them.

import Link from "next/link";
import { cn } from "@/lib/utils";

/** A section or group title with its description. */
export function SettingsHeading({ title, description, level = 2 }: { title: React.ReactNode; description?: React.ReactNode; level?: 2 | 3 | 4 }) {
  const Tag = `h${level}` as const;
  return (
    <div>
      <Tag className="flex min-h-8 items-center text-sm font-medium">{title}</Tag>
      {description && <div className="text-sm text-muted-foreground">{description}</div>}
    </div>
  );
}

/** A titled block of rows or a form. The first one on a page has no rule above it. */
export function SettingsSection({ id, title, description, level, children }: { id?: string; title: React.ReactNode; description?: React.ReactNode; level?: 2 | 3 | 4; children: React.ReactNode }) {
  return (
    <section id={id} className={cn("scroll-mt-16 space-y-3", (level ?? 2) === 2 && "[&:not(:first-child)]:border-t [&:not(:first-child)]:pt-3")}>
      <SettingsHeading title={title} description={description} level={level} />
      {children}
    </section>
  );
}

// The one row style in Settings: Inbox-style rows, each a title and description with any controls on the right.
export function SettingsRows({ children }: { children: React.ReactNode }) {
  return <div className="flex flex-col gap-1">{children}</div>;
}

/** One row: optional leading icon, title, description, and controls that wrap under the text when narrow. A row with `href` is a link. */
export function SettingsRow({ title, description, leading, href, children }: { title: React.ReactNode; description?: React.ReactNode; leading?: React.ReactNode; href?: string; children?: React.ReactNode }) {
  // The controls wrap under the text when the row is narrow, so a long title is never squashed beside them.
  const body = (
    <>
      <div className="flex min-w-[12rem] flex-1 items-center gap-3">
        {leading}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2 text-sm font-medium">{title}</div>
          {description && <div className="text-xs text-muted-foreground">{description}</div>}
        </div>
      </div>
      {children && <div className="flex shrink-0 flex-wrap items-center gap-2">{children}</div>}
    </>
  );
  const className = "flex flex-wrap items-center gap-x-3 gap-y-3 rounded-lg p-3";
  return href ? <Link href={href} className={cn(className, "hover:bg-muted/50")}>{body}</Link> : <div className={className}>{body}</div>;
}

/** The line shown in place of an empty list. */
export function SettingsEmpty({ children }: { children: React.ReactNode }) {
  return <p className="rounded-lg p-3 text-sm text-muted-foreground">{children}</p>;
}
