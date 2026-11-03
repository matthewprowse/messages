"use client";

// Inbox layout: thread list on the left, open conversation on the right. Below the md breakpoint only one shows, depending on whether a thread is open.
// Also puts the unread count in the browser tab title, so a busy tab in the background shows something new.

import { Suspense, useEffect } from "react";
import { usePathname } from "next/navigation";
import { ThreadList } from "@/components/thread-list";
import { useApp } from "@/lib/store";
import { inboxCounts } from "@/lib/thread-list";
import { titleWithCount } from "@/lib/thread-read";
import { cn } from "@/lib/utils";

/** The tab title with "(3)" in front while there are unread conversations. */
function useTabCount() {
  const { threads } = useApp();
  const { unread } = inboxCounts(threads);
  useEffect(() => {
    document.title = titleWithCount(document.title, unread);
    // Next sets the page's own title on navigation; leaving the Inbox takes the count off.
    return () => { document.title = titleWithCount(document.title, 0); };
  }, [unread]);
}

export default function InboxLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const isDetail = /^\/inbox\/[^/]+/.test(pathname);
  useTabCount();
  return (
    <div className="flex h-full min-h-0">
      <aside className={cn("h-full w-full shrink-0 flex-col md:flex md:w-80 lg:w-1/3", isDetail ? "hidden" : "flex")}>
        <Suspense fallback={null}>
          <ThreadList />
        </Suspense>
      </aside>
      <section className={cn("h-full w-full min-w-0 shrink-0 flex-col bg-muted/50 md:flex md:flex-1", isDetail ? "flex" : "hidden")}>{children}</section>
    </div>
  );
}
