"use client";

// Placeholder tiles for the Attachments grid while files load or a filter searches the rest, shaped like the white tiles.

import { cn } from "@/lib/utils";
import { Skeleton } from "@/components/ui/skeleton";

/** A row or two of grey tiles with a caption line under each, announced as loading. */
export function LoadingTiles({ label = "Loading Attachments", count = 12, className }: { label?: string; count?: number; className?: string }) {
  return (
    <div role="status" aria-busy="true" aria-label={label} className={cn("grid gap-x-3 gap-y-4", className)}>
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="flex flex-col gap-1">
          <Skeleton className="aspect-square w-full rounded-lg border bg-background" />
          <Skeleton className="h-4 w-3/4" />
        </div>
      ))}
    </div>
  );
}
