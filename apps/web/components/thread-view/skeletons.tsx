// Placeholders for a conversation while it loads: the whole layout (ConversationSkeleton, re-exported by thread-view.tsx)
// and the bubbles alone (shown inside the open view until its messages arrive).

import { cn } from "@/lib/utils";
import { Skeleton } from "@/components/ui/skeleton";

/** Placeholder bubbles while a conversation's messages load. */
export function BubblesSkeleton() {
  return (
    <div className="flex flex-col gap-6" aria-hidden>
      <Skeleton className="mx-auto h-4 w-24" />
      {(["w-3/5", "w-2/5", "w-1/2", "w-1/3"] as const).map((w, i) => (
        <div key={i} className={cn("flex flex-col gap-2", i % 2 ? "items-end" : "items-start")}>
          <Skeleton className={cn("h-14 rounded-lg", w)} />
          <Skeleton className="mx-3 h-3 w-28" />
        </div>
      ))}
    </div>
  );
}

/** The conversation layout, header, bubbles and reply box, while it loads. */
export function ConversationSkeleton() {
  return (
    <div className="flex h-full flex-col" aria-busy aria-label="Loading Conversation">
      <div className="flex shrink-0 items-center gap-3 border-b p-3 md:px-4">
        <Skeleton className="size-8 rounded-full" />
        <div className="grid gap-1.5">
          <Skeleton className="h-4 w-36" />
          <Skeleton className="h-3 w-48" />
        </div>
        <Skeleton className="ml-auto size-9 rounded-md" />
      </div>
      <div className="min-h-0 flex-1 overflow-hidden p-3 md:px-4">
        <div className="mx-auto w-full max-w-2xl"><BubblesSkeleton /></div>
      </div>
      <div className="shrink-0 border-t p-3 md:px-4">
        <div className="mx-auto w-full max-w-2xl rounded-lg border p-3">
          <Skeleton className="h-3 w-40" />
          <Skeleton className="mt-4 h-5 w-full" />
          <div className="mt-6 flex items-center justify-between">
            <Skeleton className="h-9 w-28" />
            <Skeleton className="h-9 w-32" />
          </div>
        </div>
      </div>
    </div>
  );
}
