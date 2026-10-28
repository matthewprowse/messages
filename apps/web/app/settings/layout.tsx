"use client";

// A fixed-width list on the left, the selected section filling the rest.

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Bell, ChevronRight, Gauge, Link2, SlidersHorizontal, Sparkles, Users, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { PaneHeader } from "@/components/pane";
import { ScrollArea } from "@/components/ui/scroll-area";

const SECTIONS: { href: string; label: string; icon: LucideIcon }[] = [
  { href: "/settings/accounts", label: "Connected Accounts", icon: Link2 },
  { href: "/settings/personalisation", label: "Personalisation", icon: Sparkles },
  { href: "/settings/notifications", label: "Notifications", icon: Bell },
  { href: "/settings/usage", label: "Usage", icon: Gauge },
  { href: "/settings/team", label: "Team", icon: Users },
  { href: "/settings/general", label: "General", icon: SlidersHorizontal },
];

export default function SettingsLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const isIndex = pathname === "/settings";
  return (
    <div className="flex h-full min-h-0">
      <aside className={cn("h-full w-full shrink-0 flex-col border-r-0 md:flex md:w-72 md:border-r", isIndex ? "flex" : "hidden")}>
        <div className="shrink-0"><PaneHeader title="Settings" /></div>
        <ScrollArea className="min-h-0 flex-1">
          <nav aria-label="Settings" className="flex flex-col gap-1 p-3">
            {SECTIONS.map((s) => {
              const selected = pathname.startsWith(s.href);
              return (
                <Link
                  key={s.href}
                  href={s.href}
                  aria-current={selected ? "page" : undefined}
                  className={cn(
                    "flex items-center gap-3 rounded-lg p-3 outline-none focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:ring-inset",
                    selected ? "bg-muted md:bg-muted" : "hover:bg-muted/50",
                  )}
                >
                  <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-muted"><s.icon className="size-4" /></span>
                  <span className="min-w-0 flex-1 truncate text-sm font-medium">{s.label}</span>
                  <ChevronRight className="size-4 text-muted-foreground md:hidden" aria-hidden />
                </Link>
              );
            })}
          </nav>
        </ScrollArea>
      </aside>
      <section className={cn("h-full w-full min-w-0 shrink-0 md:block md:w-auto md:flex-1", isIndex ? "hidden" : "block")}>
        <ScrollArea className="h-full">
          {/* The page's header is a full-width band; everything after it is set in by 12px. */}
          <div className="w-full pb-3 [&>*:not([data-settings-header])]:mx-3 [&>*:not([data-settings-header])]:max-w-2xl [&>[data-settings-header]+*]:mt-3">{children}</div>
        </ScrollArea>
      </section>
    </div>
  );
}
