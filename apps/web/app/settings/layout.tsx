"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { ScrollArea } from "@/components/ui/scroll-area";

const SECTIONS = [
  { href: "/settings/accounts", label: "Connected Accounts" },
  { href: "/settings/personalisation", label: "Personalisation" },
  { href: "/settings/notifications", label: "Notifications" },
  { href: "/settings/usage", label: "Usage" },
  { href: "/settings/general", label: "General" },
];

// A fixed-width list on the left, the selected section filling the rest.
export default function SettingsLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const isIndex = pathname === "/settings";
  return (
    <div className="flex h-full min-h-0">
      <aside className={cn("h-full w-full shrink-0 flex-col md:flex md:w-56", isIndex ? "flex" : "hidden")}>
        {/* Solid, with a line under it, as in Summary; the scrollbar starts below its 65px. */}
        <ScrollArea className="h-full" scrollbarClassName="data-vertical:top-[65px]! data-vertical:h-auto!">
          <div className="sticky top-0 z-10 border-b bg-background p-3">
            <h1 className="flex h-10 items-center text-lg font-medium">Settings</h1>
          </div>
          <div className="p-3">
            <div className="flex flex-col gap-3">
              {SECTIONS.map((s) => {
                const selected = pathname.startsWith(s.href);
                return (
                  <Link
                    key={s.href}
                    href={s.href}
                    aria-current={selected ? "page" : undefined}
                    className={cn(
                      "flex h-10 scroll-mt-16 items-center justify-between rounded-lg md:h-8 px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:ring-inset",
                      selected ? "bg-muted" : "hover:bg-muted/50",
                    )}
                  >
                    {s.label}
                    <ChevronRight className="size-4 text-muted-foreground md:hidden" aria-hidden />
                  </Link>
                );
              })}
            </div>
          </div>
        </ScrollArea>
      </aside>
      <section className={cn("h-full w-full min-w-0 shrink-0 md:block md:w-auto md:flex-1", isIndex ? "hidden" : "block")}>
        <ScrollArea className="h-full">
          {/* Starts beside the list, with its title on the same line as Settings. */}
          <div className="w-full max-w-2xl p-3">{children}</div>
        </ScrollArea>
      </section>
    </div>
  );
}
