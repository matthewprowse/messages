"use client";

// Settings is laid out like Conversations: the list of sections in the aside, the open section in the grey pane beside it.
// Below the md breakpoint only one shows: the list at /settings, the section anywhere under it.

import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { SettingsList } from "@/components/settings/settings-list";

export default function SettingsLayout({ children }: { children: React.ReactNode }) {
  const isIndex = usePathname() === "/settings";
  return (
    <div className="flex h-full min-h-0">
      <aside className={cn("h-full w-full shrink-0 flex-col md:flex md:w-80 md:border-r lg:w-1/3", isIndex ? "flex" : "hidden")}>
        <SettingsList />
      </aside>
      <section className={cn("h-full w-full min-w-0 shrink-0 flex-col bg-muted/50 md:flex md:flex-1", isIndex ? "hidden" : "flex")}>{children}</section>
    </div>
  );
}
