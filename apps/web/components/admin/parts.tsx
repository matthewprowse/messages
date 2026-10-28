"use client";

// Layout pieces shared by the Admin views: the column, a section heading and the Inbox-style row.

import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/** The column every Admin view sits in. */
export function AdminColumn({ children }: { children: ReactNode }) {
  return <div className="mx-auto w-full max-w-3xl p-3 md:px-4">{children}</div>;
}

/** A section heading with its one-line explanation. */
export function AdminHeading({ title, description }: { title: string; description?: string }) {
  return (
    <div className="px-3 pb-1">
      <h2 className="text-sm font-medium">{title}</h2>
      {description && <p className="mt-1 text-xs text-muted-foreground">{description}</p>}
    </div>
  );
}

/** One row in the Inbox style: an optional size-8 icon, a title and a quiet line, and the controls on the right. */
export function AdminRow({ icon, title, description, children, className }: { icon?: ReactNode; title: ReactNode; description?: ReactNode; children?: ReactNode; className?: string }) {
  return (
    <div className={cn("flex flex-wrap items-center gap-3 rounded-lg p-3 hover:bg-muted/50", className)}>
      {icon && <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground [&_svg]:size-4">{icon}</div>}
      <div className="min-w-48 flex-1">
        <div className="flex flex-wrap items-center gap-2 text-sm font-medium">{title}</div>
        {description && <div className="text-xs text-muted-foreground">{description}</div>}
      </div>
      {children && <div className="flex shrink-0 items-center gap-2">{children}</div>}
    </div>
  );
}
