"use client";

// Same split as the Conversations page: the Summary a third wide, the open conversation beside it. On phones one shows at a time.

import { Suspense } from "react";
import { usePathname } from "next/navigation";
import { SummaryList } from "@/components/summary-list";
import { useWide } from "@/lib/use-wide";
import { cn } from "@/lib/utils";

export default function SummaryLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const isDetail = /^\/summary\/[^/]+/.test(pathname);
  const wide = useWide();
  return (
    <div className="flex h-full min-h-0">
      <aside className={cn("h-full w-full shrink-0 flex-col md:flex md:w-80 md:border-r lg:w-1/3", isDetail ? "hidden" : "flex")}>
        <Suspense fallback={null}>
          <SummaryList />
        </Suspense>
      </aside>
      <section className={cn("h-full w-full min-w-0 shrink-0 flex-col bg-muted/50 md:flex md:flex-1", isDetail ? "flex" : "hidden")}>
        {/* A phone with nothing open shows only the list: Your Day would load its data unseen, so it is not mounted. */}
        {wide || isDetail ? children : null}
      </section>
    </div>
  );
}
