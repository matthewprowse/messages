// The placeholder rows shown while conversations load.

import { Skeleton } from "@/components/ui/skeleton";

/** The placeholder rows shown while conversations load. */
export function LoadingRows() {
  return (
    <div className="flex flex-col gap-2" role="status" aria-busy="true" aria-label="Loading conversations">
      {Array.from({ length: 8 }, (_, i) => (
        <div key={i} className="flex items-center gap-3 p-3">
          <Skeleton className="size-10 shrink-0 rounded-full" />
          <div className="flex flex-1 flex-col gap-1">
            <Skeleton className="h-5 w-2/3" />
            <Skeleton className="h-4 w-5/6" />
          </div>
        </div>
      ))}
    </div>
  );
}
