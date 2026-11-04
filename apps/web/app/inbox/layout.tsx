"use client";

// Inbox layout: thread list on the left, open conversation on the right. Below the md breakpoint only one shows, depending on whether a thread is open.
// Also puts the unread count in the browser tab title, so a busy tab in the background shows something new.

import { Suspense, useEffect, useMemo } from "react";
import { usePathname } from "next/navigation";
import { ThreadList } from "@/components/thread-list";
import { useApp } from "@/lib/store";
import { inboxCounts } from "@/lib/thread-list";
import { titleWithCount } from "@/lib/thread-read";
import { useWide } from "@/lib/use-wide";
import { cn } from "@/lib/utils";

/** The tab title with "(3)" in front while there are unread conversations. */
function useTabCount() {
  const { threads } = useApp();
  // The layout re-renders on every store change; the unread count only moves when the threads do.
  const { unread } = useMemo(() => inboxCounts(threads), [threads]);
  useEffect(() => {
    document.title = titleWithCount(document.title, unread);
    // Next sets the page's own title on navigation; leaving the Inbox takes the count off.
    return () => { document.title = titleWithCount(document.title, 0); };
  }, [unread]);
}

export default function InboxLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const isDetail = /^\/inbox\/[^/]+/.test(pathname);
  const wide = useWide();
  useTabCount();
  return (
    <div className="flex h-full min-h-0">
      <aside className={cn("h-full w-full shrink-0 flex-col md:flex md:w-80 md:border-r lg:w-1/3", isDetail ? "hidden" : "flex")}>
        <Suspense fallback={null}>
          <ThreadList />
        </Suspense>
      </aside>
      <section className={cn("h-full w-full min-w-0 shrink-0 flex-col bg-muted/50 md:flex md:flex-1", isDetail ? "flex" : "hidden")}>
        {/* A phone with nothing open shows only the list: the home pane would load its data unseen, so it is not mounted. */}
        {wide || isDetail ? children : null}
      </section>
    </div>
  );
}
