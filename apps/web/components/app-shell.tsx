"use client";

import Link from "next/link";
import { Suspense, useEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useAuth, useIsOwner } from "@/lib/auth";
import { SearchCommand, ShortcutsDialog, goToHint } from "@/components/search-command";
import { NEW_ITEM_EVENT, NewMenu } from "@/components/new-menu";
import { Search, Newspaper, Calendar, Inbox, Users, Paperclip, NotebookPen, Settings, ChartColumn, Ellipsis, Mail, MessageCircle, CalendarPlus, type LucideIcon } from "lucide-react";
import { useApp } from "@/lib/store";
import { AppTour } from "@/components/tour";
import { SyncBar } from "@/components/sync-bar";
import { SetupDialog } from "@/components/onboarding/setup-dialog";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Kbd } from "@/components/ui/kbd";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

const NAV: { href: string; label: string; icon: LucideIcon }[] = [
  { href: "/briefing", label: "Summary", icon: Newspaper },
  { href: "/calendar", label: "Calendar", icon: Calendar },
  { href: "/inbox", label: "Conversations", icon: Inbox },
  { href: "/contacts", label: "Contacts", icon: Users },
  { href: "/attachments", label: "Attachments", icon: Paperclip },
  { href: "/notes", label: "Notes", icon: NotebookPen },
];

const PRIMARY = NAV.slice(0, 4);
const SECONDARY = NAV.slice(4);

// On phones the rail and its New button are hidden, so More starts new things. The rail's NewMenu stays
// mounted (only hidden) and opens the dialog when it hears NEW_ITEM_EVENT.
const NEW_ITEMS: { item: "email" | "whatsapp" | "event"; label: string; icon: LucideIcon }[] = [
  { item: "email", label: "New Email", icon: Mail },
  { item: "whatsapp", label: "New WhatsApp Message", icon: MessageCircle },
  { item: "event", label: "New Event", icon: CalendarPlus },
];

// Detail routes have their own back button on phones, so navigation steps aside there.
const DETAIL_ROUTES: RegExp[] = [
  /^\/(inbox|briefing|notes)\/[^/]+/,
  /^\/contacts\/(?!companies$|merges$)[^/]+$/,
  /^\/contacts\/(companies|merges)(\/.*)?$/,
  /^\/settings\/[^/]+/,
];

function useIsDetailRoute() {
  const pathname = usePathname();
  return DETAIL_ROUTES.some((r) => r.test(pathname));
}

/** True when any inbox thread is unread. */
function useHasUnread() {
  const { threads } = useApp();
  return threads.some((t) => t.unread && t.status === "inbox");
}

/** How many conversations need you: urgent or waiting on your reply, and not already answered. */
function useAttentionCount() {
  const { threads } = useApp();
  return threads.filter((t) => t.status === "inbox" && !t.junk && !t.lastFromMe && (t.priority === "urgent" || t.needsReply)).length;
}

function UnreadDot() {
  return <span aria-hidden className="absolute top-1 right-1 size-2 rounded-full bg-primary" />;
}

/** The data-tour name of a navigation item: the first part of its path, which the tour and page hints point at. */
const tourOf = (href: string) => href.split("/")[1];

function RailButton({ href, onClick, label, icon: Icon, active, dot, dotLabel = "Unread", hint }: { href?: string; onClick?: () => void; label: string; icon: LucideIcon; active: boolean; dot?: boolean; dotLabel?: string; hint?: string }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        {href ? (
          <Button asChild variant={active ? "secondary" : "ghost"} size="icon" className="relative">
            <Link href={href} aria-label={dot ? `${label}, ${dotLabel}` : label} aria-current={active ? "page" : undefined} data-tour={tourOf(href)} data-tour-side="right">
              <Icon />
              {dot && <UnreadDot />}
            </Link>
          </Button>
        ) : (
          <Button variant={active ? "secondary" : "ghost"} size="icon" aria-label={label} onClick={onClick}>
            <Icon />
          </Button>
        )}
      </TooltipTrigger>
      <TooltipContent side="right">{label}{hint && <> <Kbd>{hint}</Kbd></>}</TooltipContent>
    </Tooltip>
  );
}

function Rail({ searchOpen, onSearch }: { searchOpen: boolean; onSearch: () => void }) {
  const pathname = usePathname();
  const isOwner = useIsOwner();
  const hasUnread = useHasUnread();
  const attention = useAttentionCount();
  return (
    // Scrolls on short screens so every item stays reachable. Below md the bottom bar takes over.
    <nav aria-label="Main" className="hidden h-full shrink-0 flex-col gap-3 overflow-y-auto border-r p-3 md:flex">
      <RailButton onClick={onSearch} label="Search" icon={Search} active={searchOpen} hint="⌘K" />
      <div className="flex flex-col gap-1">
        <div data-tour="new" data-tour-side="right"><NewMenu /></div>
        {NAV.map((item) => (
          <RailButton
            key={item.href}
            {...item}
            active={pathname.startsWith(item.href)}
            dot={item.href === "/inbox" ? hasUnread : item.href === "/briefing" && attention > 0}
            dotLabel={item.href === "/briefing" ? `${attention} Need Attention` : "Unread"}
            hint={goToHint(item.href)}
          />
        ))}
      </div>
      <div className="mt-auto flex flex-col gap-1">
        {isOwner && <RailButton href="/analytics" label="Analytics" icon={ChartColumn} active={pathname.startsWith("/analytics")} />}
        <RailButton href="/settings" label="Settings" icon={Settings} active={pathname.startsWith("/settings")} hint={goToHint("/settings")} />
      </div>
    </nav>
  );
}

function BottomBar({ hidden }: { hidden: boolean }) {
  const pathname = usePathname();
  const isOwner = useIsOwner();
  const hasUnread = useHasUnread();
  const more = [...SECONDARY, ...(isOwner ? [{ href: "/analytics", label: "Analytics", icon: ChartColumn }] : []), { href: "/settings", label: "Settings", icon: Settings }];
  const moreActive = more.some((m) => pathname.startsWith(m.href));
  // A dialog opened from the menu keeps the focus; the menu must not hand it back to More as it closes.
  const starting = useRef(false);
  if (hidden) return null;
  return (
    <nav aria-label="Main" className="fixed inset-x-0 bottom-0 z-40 border-t bg-background pb-[env(safe-area-inset-bottom)] md:hidden">
      <div className="flex h-14 items-stretch">
        {PRIMARY.map(({ href, label, icon: Icon }) => {
          const active = pathname.startsWith(href);
          const dot = href === "/inbox" && hasUnread;
          return (
            <Link
              key={href}
              href={href}
              aria-label={dot ? `${label}, Unread` : label}
              aria-current={active ? "page" : undefined}
              data-tour={tourOf(href)}
              data-tour-side="top"
              className={cn("flex flex-1 flex-col items-center justify-center gap-1 text-xs", active ? "text-foreground" : "text-muted-foreground")}
            >
              <span className="relative">
                <Icon className="size-5" />
                {dot && <span aria-hidden className="absolute -top-0.5 -right-0.5 size-2 rounded-full bg-primary" />}
              </span>
              {label}
            </Link>
          );
        })}
        <DropdownMenu>
          <DropdownMenuTrigger
            aria-label="More"
            data-tour="more"
            data-tour-side="top"
            className={cn("flex flex-1 flex-col items-center justify-center gap-1 text-xs outline-none", moreActive ? "text-foreground" : "text-muted-foreground")}
          >
            <Ellipsis className="size-5" />
            More
          </DropdownMenuTrigger>
          <DropdownMenuContent side="top" align="end" onCloseAutoFocus={(e) => { if (starting.current) { e.preventDefault(); starting.current = false; } }}>
            {NEW_ITEMS.map(({ item, label, icon: Icon }) => (
              <DropdownMenuItem key={item} onSelect={() => { starting.current = true; window.dispatchEvent(new CustomEvent(NEW_ITEM_EVENT, { detail: item })); }}>
                <Icon />
                {label}
              </DropdownMenuItem>
            ))}
            <DropdownMenuSeparator />
            {more.map(({ href, label, icon: Icon }) => (
              <DropdownMenuItem key={href} asChild>
                <Link href={href}>
                  <Icon />
                  {label}
                </Link>
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
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
  const onMarketing = pathname === "/";
  const isDetail = useIsDetailRoute();

  // Everything except the sign-in page and the marketing page needs a signed-in user: row-level security returns nothing otherwise.
  useEffect(() => {
    if (session === null && !onLogin && !onMarketing) router.replace("/login");
  }, [session, onLogin, onMarketing, router]);

  if (onMarketing) return children;
  if (onLogin) return <main className="h-dvh w-full">{children}</main>;
  if (!session) return <div className="h-dvh w-full" />; // checking the stored session, or redirecting

  return (
    <div className="flex h-dvh w-full overflow-hidden">
      {/* First in the tab order: hidden until focused, then jumps past the navigation. */}
      <a
        href="#content"
        className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:rounded-lg focus:bg-primary focus:px-3 focus:py-2 focus:text-sm focus:font-medium focus:text-primary-foreground focus:outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
      >
        Skip to Content
      </a>
      <Rail searchOpen={searchOpen} onSearch={() => setSearchOpen(true)} />
      <SearchCommand open={searchOpen} onOpenChange={setSearchOpen} />
      <ShortcutsDialog />
      <main id="content" tabIndex={-1} className={cn("flex h-full min-w-0 flex-1 flex-col outline-none", !isDetail && "pb-[calc(3.5rem+env(safe-area-inset-bottom))] md:pb-0")}>
        <SyncBar />
        <div className="min-h-0 flex-1">{children}</div>
      </main>
      <BottomBar hidden={isDetail} />
      <AppTour />
      <Suspense><SetupDialog /></Suspense>
    </div>
  );
}
