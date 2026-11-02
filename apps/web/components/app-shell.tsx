"use client";

// The frame around every signed-in page: navigation rail and bottom bar, the New menu, search palette, sync bar,
// and the dialogs that open over the app (setup, team review).

import Link from "next/link";
import dynamic from "next/dynamic";
import { Suspense, useEffect, useMemo, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useAuth, useIsOwner } from "@/lib/auth";
import { NewMenu } from "@/components/new-menu";
import { Search, Newspaper, Calendar, Inbox, Users, Paperclip, NotebookPen, Settings, ChartColumn, ShieldCheck, Ellipsis, type LucideIcon } from "lucide-react";
import { useApp } from "@/lib/store";
import { useOnboardingMeta } from "@/lib/onboarding";
import { useMyTeam } from "@/lib/share";
import { attentionCount } from "@/lib/summary";
import { useNow } from "@/components/summary/use-now";
import { PwaBoot } from "@/components/pwa-boot";
import { NoteCaptureShortcut } from "@/components/note-capture";
import { SyncBar } from "@/components/sync-bar";
import { UsageRing } from "@/components/usage-ring";
import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/ui/kbd";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

// Search (with cmdk), setup and team review load in their own chunks, so the first page does not carry them.
const SearchCommand = dynamic(() => import("@/components/search-command").then((m) => m.SearchCommand), { ssr: false });
const ShortcutsDialog = dynamic(() => import("@/components/search-command").then((m) => m.ShortcutsDialog), { ssr: false });
const SetupDialog = dynamic(() => import("@/components/onboarding/setup-dialog").then((m) => m.SetupDialog), { ssr: false });
const TeamReview = dynamic(() => import("@/components/team-review").then((m) => m.TeamReview), { ssr: false });

const NAV: { href: string; label: string; icon: LucideIcon }[] = [
  { href: "/summary", label: "Summary", icon: Newspaper },
  { href: "/calendar", label: "Calendar", icon: Calendar },
  { href: "/inbox", label: "Inbox", icon: Inbox },
  { href: "/contacts", label: "Contacts", icon: Users },
  { href: "/attachments", label: "Attachments", icon: Paperclip },
  { href: "/notes", label: "Notes", icon: NotebookPen },
];

const PRIMARY = NAV.slice(0, 4);
const SECONDARY = NAV.slice(4);

// Detail routes have their own back button on phones, so navigation steps aside there.
const DETAIL_ROUTES: RegExp[] = [
  /^\/(inbox|summary|notes)\/[^/]+/,
  /^\/contacts\/(?!companies$|merges$)[^/]+$/,
  /^\/contacts\/(companies|merges)(\/.*)?$/,
  /^\/settings\/[^/]+/,
];

function useIsDetailRoute() {
  const pathname = usePathname();
  return DETAIL_ROUTES.some((r) => r.test(pathname));
}

/** How often the Summary dot re-checks the time windows (a conversation ages out of them, not into them). */
const ATTENTION_REFRESH_MS = 5 * 60_000;

/** True when any inbox thread is unread. Junk and Subscriptions do not count, or the dot would almost always be lit. */
function useHasUnread() {
  const { threads } = useApp();
  return threads.some((t) => t.unread && t.status === "inbox" && !t.junk);
}

/** How many conversations the Summary lists as needing you. It is the page's own count (lib/summary.ts), so the dot never disagrees with the page. */
function useAttentionCount() {
  const { threads } = useApp();
  const now = useNow(ATTENTION_REFRESH_MS);
  return useMemo(() => attentionCount(threads, now), [threads, now]);
}

function UnreadDot() {
  return <span aria-hidden className="absolute top-1 right-1 size-2 rounded-full bg-primary" />;
}


function RailButton({ href, onClick, label, icon: Icon, active, dot, dotLabel = "Unread", hint }: { href?: string; onClick?: () => void; label: string; icon: LucideIcon; active: boolean; dot?: boolean; dotLabel?: string; hint?: string }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        {href ? (
          <Button asChild variant={active ? "secondary" : "ghost"} size="icon" className="relative">
            <Link href={href} aria-label={dot ? `${label}, ${dotLabel}` : label} aria-current={active ? "page" : undefined}>
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
  const isOwner = useIsOwner();
  const pathname = usePathname();
  const hasUnread = useHasUnread();
  const attention = useAttentionCount();
  return (
    // Scrolls on short screens so every item stays reachable. Below md the bottom bar takes over.
    <nav aria-label="Main" className="hidden h-full shrink-0 flex-col gap-3 overflow-y-auto border-r p-3 md:flex">
      <RailButton onClick={onSearch} label="Search" icon={Search} active={searchOpen} hint="⌘K" />
      <div className="flex flex-col gap-1">
        <div><NewMenu /></div>
        {NAV.map((item) => (
          <RailButton
            key={item.href}
            {...item}
            active={pathname.startsWith(item.href)}
            dot={item.href === "/inbox" ? hasUnread : item.href === "/summary" && attention > 0}
            dotLabel={item.href === "/summary" ? `${attention} Need Attention` : "Unread"}
          />
        ))}
      </div>
      <div className="mt-auto flex flex-col gap-1">
        {isOwner && <RailButton href="/analytics" label="Analytics" icon={ChartColumn} active={pathname.startsWith("/analytics")} />}
        {isOwner && <RailButton href="/admin" label="Admin" icon={ShieldCheck} active={pathname.startsWith("/admin") || pathname.startsWith("/updates")} />}
        <RailButton href="/settings" label="Settings" icon={Settings} active={pathname.startsWith("/settings") && !pathname.startsWith("/settings/usage")} />
        <UsageRing />
      </div>
    </nav>
  );
}

function BottomBar({ hidden }: { hidden: boolean }) {
  const pathname = usePathname();
  const hasUnread = useHasUnread();
  // More is its own screen (app/more), so it is lit there and on the places it leads to that the bar does not have.
  const moreActive = ["/more", ...SECONDARY.map((m) => m.href), "/analytics", "/updates", "/admin", "/settings"].some((href) => pathname.startsWith(href));
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
        <Link
          href="/more"
          aria-label="More"
          aria-current={pathname === "/more" ? "page" : undefined}
          className={cn("flex flex-1 flex-col items-center justify-center gap-1 text-xs", moreActive ? "text-foreground" : "text-muted-foreground")}
        >
          <Ellipsis className="size-5" />
          More
        </Link>
      </div>
    </nav>
  );
}

/** True once the browser is idle after the first paint, or sooner when `now` is set (a search shortcut or click). */
function useAfterIdle(now: boolean) {
  const [idle, setIdle] = useState(false);
  useEffect(() => {
    if (idle) return;
    const w = window as Window & { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number; cancelIdleCallback?: (id: number) => void };
    if (w.requestIdleCallback) {
      const id = w.requestIdleCallback(() => setIdle(true), { timeout: 3000 });
      return () => w.cancelIdleCallback?.(id);
    }
    const id = window.setTimeout(() => setIdle(true), 1500);
    return () => window.clearTimeout(id);
  }, [idle]);
  return idle || now;
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const [searchOpen, setSearchOpen] = useState(false);
  const { session } = useAuth();
  const pathname = usePathname();
  const router = useRouter();
  const onLogin = pathname === "/login";
  const onInvite = pathname.startsWith("/invite/");
  const isDetail = useIsDetailRoute();
  const meta = useOnboardingMeta();
  const team = useMyTeam();

  // Search, its G-then-letter shortcuts and the ? dialog load once the page is idle; Cmd/Ctrl+K or a click on Search loads them at once.
  const [wantSearch, setWantSearch] = useState(false);
  const searchReady = useAfterIdle(wantSearch);
  useEffect(() => {
    if (searchReady) return;
    function onKey(e: KeyboardEvent) {
      if (e.key.toLowerCase() === "k" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); setWantSearch(true); setSearchOpen(true); }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [searchReady]);

  // The dialogs only when they could show: setup until it is done, team review for someone in a team.
  const onboarding = meta.onboarding !== "done";
  const reviewPending = !!team && meta.teamReview !== team.workspaceId;

  // Everything except the sign-in page and an invite link needs a signed-in user: row-level security returns nothing otherwise.
  // An invite page asks someone to sign in itself, so the link they were sent is not lost.
  useEffect(() => {
    if (session === null && !onLogin && !onInvite) router.replace("/login");
  }, [session, onLogin, onInvite, router]);

  if (onLogin || onInvite) return <main className="h-dvh w-full">{children}</main>;
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
      <PwaBoot />
      <NoteCaptureShortcut />
      <Rail searchOpen={searchOpen} onSearch={() => { setWantSearch(true); setSearchOpen(true); }} />
      {searchReady && <SearchCommand open={searchOpen} onOpenChange={setSearchOpen} />}
      {searchReady && <ShortcutsDialog />}
      <main id="content" tabIndex={-1} className={cn("flex h-full min-w-0 flex-1 flex-col outline-none", !isDetail && "pb-[calc(3.5rem+env(safe-area-inset-bottom))] md:pb-0")}>
        <SyncBar />
        {/* Phones have no rail, so the palette opens from a bar at the top of every list page (the same palette as Cmd-K). */}
        {!isDetail && (
          <div className="shrink-0 border-b px-3 py-2 md:hidden">
            <Button variant="outline" className="w-full justify-start gap-2 font-normal text-muted-foreground" onClick={() => { setWantSearch(true); setSearchOpen(true); }}>
              <Search aria-hidden />
              Search Everything
            </Button>
          </div>
        )}
        <div className="min-h-0 flex-1">{children}</div>
      </main>
      <BottomBar hidden={isDetail} />
      {onboarding && <Suspense><SetupDialog /></Suspense>}
      {reviewPending && <TeamReview />}
    </div>
  );
}
