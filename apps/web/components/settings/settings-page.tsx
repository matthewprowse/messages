"use client";

// One Settings section in the grey pane: on a phone a 40px row with Back and the title above the column; from tablet up the
// title is the column's first line, as the list beside it already shows where you are. Opening with a #card scrolls that card
// into view once it has drawn, and an old #card address that moved section is sent on to its new one.

import { useEffect, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { movedCard } from "@/lib/settings-index";
import { PaneColumn } from "@/components/surface";
import { IconAction } from "@/components/tip";

/** How long to wait for a card that draws after its data loads (Team, Usage), in ms. */
const FIND_FOR_MS = 3_000;
const STEP_MS = 100;

/** Scrolls the card with this id into view, waiting for it to draw. Returns a cancel for a page that unmounts first. */
export function scrollToCard(id: string): () => void {
  let waited = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const look = () => {
    const el = document.getElementById(id);
    if (el) return el.scrollIntoView({ block: "start", behavior: "smooth" });
    waited += STEP_MS;
    if (waited < FIND_FOR_MS) timer = setTimeout(look, STEP_MS);
  };
  look();
  return () => clearTimeout(timer);
}

/** A section's page: the phone header with Back to `back`, then the title and the cards in the centred column. */
export function SettingsPage({ title, back = "/settings", width = "2xl", children }: { title: ReactNode; back?: string; width?: "2xl" | "5xl"; children: ReactNode }) {
  const router = useRouter();
  useEffect(() => {
    const hash = window.location.hash;
    if (!hash) return;
    const moved = movedCard(`${window.location.pathname}${hash}`);
    if (moved) { router.replace(moved); return; }
    return scrollToCard(decodeURIComponent(hash.slice(1)));
  }, [router]);
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-center gap-1 px-3 pt-3 md:hidden">
        <IconAction label="Back" icon={ArrowLeft} onClick={() => router.push(back)} />
        <h1 className="flex h-10 min-w-0 items-center truncate text-xl font-medium">{title}</h1>
      </div>
      <div className="min-h-0 flex-1">
        <PaneColumn width={width}>
          <h1 className="hidden pb-3 text-2xl font-medium md:block">{title}</h1>
          {children}
        </PaneColumn>
      </div>
    </div>
  );
}
