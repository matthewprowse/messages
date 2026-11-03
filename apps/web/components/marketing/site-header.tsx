"use client";

// The marketing site's top bar: the Konva mark, the main sections and pages, and Log In (Open App once signed in)
// beside Request Access. On phones the links open as a full screen menu under the bar.

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Menu, X } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { Logo } from "@/components/logo";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const LINKS = [
  { href: "/#product", label: "Product" },
  { href: "/#industries", label: "Industries" },
  { href: "/pricing", label: "Pricing" },
  { href: "/security", label: "Security" },
  { href: "/updates", label: "Updates" },
];

/** The phone menu: every link in large type, then Log In and Request Access at the bottom. It covers the page under the bar. */
function MobileMenu({ signedIn, onClose }: { signedIn: boolean; onClose: () => void }) {
  // The page under it must not scroll, and Escape closes it like a dialog.
  useEffect(() => {
    const before = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => { document.body.style.overflow = before; window.removeEventListener("keydown", onKey); };
  }, [onClose]);
  return (
    <div id="site-menu" className="fixed inset-x-0 top-[calc(3.5rem+env(safe-area-inset-top))] bottom-0 z-40 flex flex-col overflow-y-auto bg-background px-4 pb-[calc(1rem+env(safe-area-inset-bottom))] animate-in fade-in-0 duration-150 md:hidden">
      <nav aria-label="Main" className="flex flex-col pt-2">
        {LINKS.map((l, i) => (
          <Link key={l.href} href={l.href} onClick={onClose} style={{ animationDelay: `${i * 30}ms` }} className="flex h-16 items-center text-3xl font-semibold tracking-tight outline-none animate-in fade-in-0 slide-in-from-top-2 fill-mode-both duration-300 focus-visible:text-muted-foreground">
            {l.label}
          </Link>
        ))}
      </nav>
      <div className="mt-auto flex flex-col gap-2 pt-10">
        <Button asChild variant="secondary" size="lg"><Link href={signedIn ? "/inbox" : "/login"} onClick={onClose}>{signedIn ? "Open App" : "Log In"}</Link></Button>
        <Button asChild size="lg"><Link href="/request-access" onClick={onClose}>Request Access</Link></Button>
      </div>
    </div>
  );
}

export function SiteHeader() {
  const { session } = useAuth();
  const pathname = usePathname();
  // The menu is open on the page it was opened on, so going to another page closes it by itself.
  const [openOn, setOpenOn] = useState<string | null>(null);
  const open = openOn === pathname;
  const close = useCallback(() => setOpenOn(null), []);
  return (
    <header className={cn("safe-top sticky top-0 z-50", open ? "bg-background" : "bg-background/80 backdrop-blur-md")}>
      <div className="mx-auto flex h-14 max-w-6xl items-center gap-6 px-4 md:px-6">
        <Link href="/" className="flex items-center gap-2 rounded-md text-sm font-semibold outline-none focus-visible:ring-3 focus-visible:ring-ring/50">
          <Logo className="w-5" />
          Konva
        </Link>
        <nav aria-label="Main" className="hidden items-center gap-1 md:flex">
          {LINKS.map((l) => (
            <Button key={l.href} asChild variant="ghost" className="text-muted-foreground hover:text-foreground aria-[current=page]:text-foreground">
              <Link href={l.href} aria-current={pathname === l.href ? "page" : undefined}>{l.label}</Link>
            </Button>
          ))}
        </nav>
        <div className="ml-auto flex items-center gap-2">
          <Button asChild variant="ghost" className="max-md:hidden">
            <Link href={session ? "/inbox" : "/login"}>{session ? "Open App" : "Log In"}</Link>
          </Button>
          <Button asChild className={cn(open && "max-md:hidden")}><Link href="/request-access">Request Access</Link></Button>
          <Button variant="ghost" size="icon" className="md:hidden" aria-label={open ? "Close Menu" : "Menu"} aria-expanded={open} aria-controls="site-menu" onClick={() => (open ? close() : setOpenOn(pathname))}>
            {open ? <X /> : <Menu />}
          </Button>
        </div>
      </div>
      {open && <MobileMenu signedIn={!!session} onClose={close} />}
    </header>
  );
}
