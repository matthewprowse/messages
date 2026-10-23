"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth";
import { SearchCommand } from "@/components/search-command";
import { NewMenu } from "@/components/new-menu";
import { Search, Newspaper, Calendar, Inbox, Users, Paperclip, Settings, type LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

const NAV: { href: string; label: string; icon: LucideIcon }[] = [
  { href: "/briefing", label: "Summary", icon: Newspaper },
  { href: "/calendar", label: "Calendar", icon: Calendar },
  { href: "/inbox", label: "Conversations", icon: Inbox },
  { href: "/contacts", label: "Contacts", icon: Users },
  { href: "/attachments", label: "Attachments", icon: Paperclip },
];

function RailButton({ href, onClick, label, icon: Icon, active }: { href?: string; onClick?: () => void; label: string; icon: LucideIcon; active: boolean }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        {href ? (
          <Button asChild variant={active ? "secondary" : "ghost"} size="icon">
            <Link href={href} aria-label={label} aria-current={active ? "page" : undefined}>
              <Icon />
            </Link>
          </Button>
        ) : (
          <Button variant={active ? "secondary" : "ghost"} size="icon" aria-label={label} onClick={onClick}>
            <Icon />
          </Button>
        )}
      </TooltipTrigger>
      <TooltipContent side="right">{label}</TooltipContent>
    </Tooltip>
  );
}

function Rail({ searchOpen, onSearch }: { searchOpen: boolean; onSearch: () => void }) {
  const pathname = usePathname();
  // On phones an open conversation or contact has its own back button, so the rail steps aside.
  const isThread = /^\/(inbox|briefing|contacts)\/[^/]+/.test(pathname);
  return (
    // Scrolls on short screens (a phone in landscape) so every item stays reachable.
    <nav aria-label="Main" className={cn("h-full shrink-0 flex-col gap-3 overflow-y-auto border-r p-3", isThread ? "hidden md:flex" : "flex")}>
      <RailButton onClick={onSearch} label="Search" icon={Search} active={searchOpen} />
      <div className="flex flex-col gap-1">
        <NewMenu />
        {NAV.map((item) => (
          <RailButton key={item.href} {...item} active={pathname.startsWith(item.href)} />
        ))}
      </div>
      <div className="mt-auto">
        <RailButton href="/settings" label="Settings" icon={Settings} active={pathname.startsWith("/settings")} />
      </div>
    </nav>
  );
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const [searchOpen, setSearchOpen] = useState(false);
  const { session } = useAuth();
  const pathname = usePathname();
  const router = useRouter();
  const onLogin = pathname === "/login";

  // Everything except the sign-in page needs a signed-in user: row-level security returns nothing otherwise.
  useEffect(() => {
    if (session === null && !onLogin) router.replace("/login");
  }, [session, onLogin, router]);

  if (onLogin) return <main className="h-svh w-full">{children}</main>;
  if (!session) return <div className="h-svh w-full" />; // checking the stored session, or redirecting

  return (
    <div className="flex h-svh w-full overflow-hidden">
      <Rail searchOpen={searchOpen} onSearch={() => setSearchOpen(true)} />
      <SearchCommand open={searchOpen} onOpenChange={setSearchOpen} />
      <main className="h-full min-w-0 flex-1">{children}</main>
    </div>
  );
}
