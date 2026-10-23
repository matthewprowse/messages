"use client";

import { Suspense } from "react";
import { usePathname } from "next/navigation";
import { SummaryList } from "@/components/summary-list";
import { cn } from "@/lib/utils";

// Same split as the Conversations page: the Summary a third wide, the open conversation beside it. On phones one shows at a time.
export default function BriefingLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const isDetail = /^\/briefing\/[^/]+/.test(pathname);
  return (
    <div className="flex h-full min-h-0">
      <aside className={cn("h-full w-full shrink-0 flex-col md:flex md:w-1/3 md:border-r", isDetail ? "hidden" : "flex")}>
        <Suspense fallback={null}>
          <SummaryList />
        </Suspense>
      </aside>
      <section className={cn("h-full w-full min-w-0 shrink-0 flex-col md:flex md:w-2/3", isDetail ? "flex" : "hidden")}>{children}</section>
    </div>
  );
}
