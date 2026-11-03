"use client";

// The frame around every signed-in page: navigation rail and bottom bar, the New menu, search palette, sync bar,
// and the dialogs that open over the app (setup, team review).

import Link from "next/link";
import dynamic from "next/dynamic";
import { Suspense, useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useAuth, useIsOwner } from "@/lib/auth";
import { NewMenu } from "@/components/new-menu";
import { Logo } from "@/components/logo";
import { Search, Newspaper, Calendar, Inbox, Users, Paperclip, NotebookPen, Settings, ChartColumn, ShieldCheck, Ellipsis, type LucideIcon } from "lucide-react";
import { useOnboardingMeta } from "@/lib/onboarding";
import { isMarketingPath } from "@/lib/marketing-routes";
import { useMyTeam } from "@/lib/share";
import { PwaBoot } from "@/components/pwa-boot";
import { NoteCaptureShortcut } from "@/components/note-capture";
import { SyncBar } from "@/components/sync-bar";
import { WhatsNewDialog } from "@/components/whats-new/whats-new-dialog";
import { UsageRing } from "@/components/usage-ring";
import { RAIL_ITEM, RAIL_LABEL, RAIL_TIP } from "@/components/rail-item";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

// Search (with cmdk), setup and team review load in their own chunks, so the first page does not carry them.
const SearchCommand = dynamic(() => import("@/components/search-command").then((m) => m.SearchCommand), { ssr: false });
const ShortcutsDialog = dynamic(() => import("@/components/search-command").then((m) => m.ShortcutsDialog), { ssr: false });
const SetupDialog = dynamic(() => import("@/components/onboarding/setup-dialog").then((m) => m.SetupDialog), { ssr: false });
const TeamReview = dynamic(() => import("@/components/team-review").then((m) => m.TeamReview), { ssr: false });

const NAV: { href: string; label: string; icon: LucideIcon }[] = [
  { href: "/summary", label: "Summary", icon: Newspaper },
  { href: "/calendar", label: "Calendar", icon: Calendar },
  { href: "/inbox", label: "Conversations", icon: Inbox },
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

function RailButton({ href, onClick, label, icon: Icon, active, tipSide = "right" }: { href?: string; onClick?: () => void; label: string; icon: LucideIcon; active: boolean; tipSide?: "right" | "top" }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        {href ? (
          <Button asChild variant={active ? "secondary" : "ghost"} size="icon" className={RAIL_ITEM}>
            <Link href={href} aria-label={label} aria-current={active ? "page" : undefined}>
              <Icon />
              <span className={RAIL_LABEL}>{label}</span>
            </Link>
          </Button>
        ) : (
          <Button variant={active ? "secondary" : "ghost"} size="icon" className={RAIL_ITEM} aria-label={label} onClick={onClick}>
            <Icon />
            <span className={RAIL_LABEL}>{label}</span>
          </Button>
        )}
      </TooltipTrigger>
      <TooltipContent side={tipSide} className={RAIL_TIP}>{label}</TooltipContent>
    </Tooltip>
  );
}

function Rail({ searchOpen, onSearch }: { searchOpen: boolean; onSearch: () => void }) {
  const isOwner = useIsOwner();
  const pathname = usePathname();
  return (
    // Scrolls on short screens so every item stays reachable. Below md the bottom bar takes over.
    <nav aria-label="Main" className="hidden h-full shrink-0 flex-col gap-3 overflow-y-auto border-r p-3 md:flex">
      <div className="flex size-10 shrink-0 items-center justify-center">
        <Logo className="w-6" />
      </div>
      <div className="flex flex-col gap-1">
        <RailButton onClick={onSearch} label="Search" icon={Search} active={searchOpen} />
        <NewMenu />
        {NAV.map((item) => <RailButton key={item.href} {...item} active={pathname.startsWith(item.href)} />)}
      </div>
      <div className="mt-auto flex flex-col gap-1">
        {isOwner && <RailButton href="/analytics" label="Analytics" icon={ChartColumn} active={pathname.startsWith("/analytics")} />}
        {isOwner && <RailButton href="/admin" label="Admin" icon={ShieldCheck} active={pathname.startsWith("/admin")} />}
        <RailButton href="/settings" label="Settings" icon={Settings} active={pathname.startsWith("/settings") && !pathname.startsWith("/settings/usage")} />
        <UsageRing />
      </div>
    </nav>
  );
}

/**
 * Phones: the rail as a dock floating over the bottom of the page, the same 40px icon buttons: Search (the same palette
 * as Cmd-K), the main places, and More for the rest.
 */
function BottomBar({ hidden, onSearch }: { hidden: boolean; onSearch: () => void }) {
  const pathname = usePathname();
  // More is its own screen (app/more), so it is lit there and on the places it leads to that the bar does not have.
  const moreActive = ["/more", ...SECONDARY.map((m) => m.href), "/analytics", "/admin", "/settings"].some((href) => pathname.startsWith(href));
  if (hidden) return null;
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-0 z-40 flex justify-center px-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] md:hidden">
      <nav aria-label="Main" className="pointer-events-auto flex gap-1 rounded-2xl border bg-background p-2 shadow-lg">
        <RailButton onClick={onSearch} label="Search" icon={Search} active={false} tipSide="top" />
        {PRIMARY.map((item) => <RailButton key={item.href} {...item} active={pathname.startsWith(item.href)} tipSide="top" />)}
        <RailButton href="/more" label="More" icon={Ellipsis} active={moreActive} tipSide="top" />
      </nav>
    </div>
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
  const onMarketing = isMarketingPath(pathname);
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
    if (session === null && !onLogin && !onInvite && !onMarketing) router.replace("/login");
  }, [session, onLogin, onInvite, onMarketing, router]);

  // viewport-fit=cover runs the page under the iOS status bar, so every frame pads by the safe area and paints that
  // strip in the page colour. Without it the top of the page (the search band, a detail header) sits under the bar.
  // The public site scrolls as a normal page, with its own header and footer (app/(marketing)/layout.tsx).
  if (onMarketing) return <>{children}</>;
  if (onLogin || onInvite) return <main className="safe-top h-dvh w-full bg-background">{children}</main>;
  if (!session) return <div className="safe-top h-dvh w-full bg-background" />; // checking the stored session, or redirecting

  return (
    <div className="safe-top flex h-dvh w-full overflow-hidden bg-background">
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
      <main id="content" tabIndex={-1} data-dock={!isDetail || undefined} className="flex h-full min-w-0 flex-1 flex-col outline-none">
        <SyncBar />
        <div className="min-h-0 flex-1">{children}</div>
      </main>
      <BottomBar hidden={isDetail} onSearch={() => { setWantSearch(true); setSearchOpen(true); }} />
      {onboarding && <Suspense><SetupDialog /></Suspense>}
      {reviewPending && <TeamReview />}
      <WhatsNewDialog />
    </div>
  );
}
