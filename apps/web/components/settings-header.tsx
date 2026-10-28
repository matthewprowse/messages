"use client";

// The same band as PaneHeader (a p-3 band with a line under it, the title row h-8), with the phone's Back button at the
// left of the title row and the description under it. The page's content follows, set in by the layout.

import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";

export function SettingsHeader({ title, description, back = "/settings", actions }: { title: string; description?: React.ReactNode; back?: string; actions?: React.ReactNode }) {
  return (
    <header data-settings-header className="sticky top-0 z-10 space-y-3 border-b bg-background p-3">
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <Button variant="ghost" size="icon" className="md:hidden" aria-label="Back" asChild><Link href={back}><ArrowLeft /></Link></Button>
          <h1 className="flex h-8 min-w-0 items-center truncate text-lg font-medium">{title}</h1>
        </div>
        {actions}
      </div>
      {description && <div className="text-sm text-muted-foreground">{description}</div>}
    </header>
  );
}
