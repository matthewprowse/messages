"use client";

import Link from "next/link";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";

// The marketing page's top bar. Someone already signed in goes straight back into the app instead.
export function MarketingNav() {
  const { session } = useAuth();
  return (
    <header className="sticky top-0 z-40 border-b bg-background/80 backdrop-blur">
      <div className="mx-auto flex h-14 max-w-5xl items-center justify-between px-4">
        <Link href="/" className="text-sm font-semibold tracking-tight">Konva</Link>
        <nav aria-label="Main" className="flex items-center gap-2">
          {session ? (
            <Button asChild size="sm"><Link href="/summary">Open Konva</Link></Button>
          ) : (
            <>
              <Button asChild variant="ghost" size="sm"><Link href="/login">Sign In</Link></Button>
              <Button asChild size="sm"><a href="#request">Request Access</a></Button>
            </>
          )}
        </nav>
      </div>
    </header>
  );
}
