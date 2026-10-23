"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
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
      <aside className={cn("h-full w-full shrink-0 flex-col md:flex md:w-64", isIndex ? "flex" : "hidden")}>
        {/* The scrollbar starts below the 64px floating header, as in Conversations. */}
        <ScrollArea className="h-full" scrollbarClassName="data-vertical:top-[64px]! data-vertical:h-auto!">
          <div className="sticky top-0 z-10 bg-background/70 p-3 backdrop-blur-xl backdrop-saturate-150">
            <h1 className="flex h-10 items-center text-lg font-medium">Settings</h1>
          </div>
          <div className="px-3 pb-3">
            <div className="flex flex-col gap-3">
              {SECTIONS.map((s) => {
                const selected = pathname.startsWith(s.href);
                return (
                  <Link
                    key={s.href}
                    href={s.href}
                    aria-current={selected ? "page" : undefined}
                    className={cn(
                      "flex h-8 scroll-mt-16 items-center rounded-lg px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:ring-inset",
                      selected ? "bg-muted" : "hover:bg-muted/50",
                    )}
                  >
                    {s.label}
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
