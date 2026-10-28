"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { track } from "@/lib/analytics";
import { saveOnboarding, useOnboardingMeta } from "@/lib/onboarding";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";

// The tour after setup: a card over the app that takes you page by page, opening each one behind it and
// marking where it lives in the navigation (the rail, or the bottom bar on phones). The page stays usable,
// so you can try things as you go. Start Tour in Settings, General, runs it again.

interface Stop {
  id: string;
  href: string;
  /** data-tour targets to mark, the first one on screen wins. */
  target: string[];
  title: string;
  points: string[];
}

const STOPS: Stop[] = [
  {
    id: "summary",
    href: "/summary",
    target: ["summary"],
    title: "Summary: Your Day at a Glance",
    points: [
      "Needs Reply lists everyone waiting on an answer from you.",
      "Important and Updates hold the rest worth knowing, sorted for you.",
      "Today's calendar sits at the top, and the play button reads you a spoken brief.",
    ],
  },
  {
    id: "inbox",
    href: "/inbox",
    target: ["inbox"],
    title: "Inbox: Email and WhatsApp Together",
    points: [
      "Every client conversation in one list, whichever app they used.",
      "Priority, Junk and Subscriptions keep the noise out of your way.",
      "Open one to reply the way you just tried: a choice, a few words, or your own text.",
    ],
  },
  {
    id: "contacts",
    href: "/contacts",
    target: ["contacts"],
    title: "Contacts: Each Person Once",
    points: [
      "Someone's email addresses and WhatsApp are joined into one contact, with every conversation on their page.",
      "Merges collects the people Konva thinks are the same, for a quick yes or no.",
      "Companies group people by where they work.",
    ],
  },
  {
    id: "calendar",
    href: "/calendar",
    target: ["calendar"],
    title: "Calendar: Everything in One View",
    points: [
      "Your Google, iCloud and Outlook calendars side by side, by day, week or month.",
      "Add an event to any of them without leaving Konva.",
    ],
  },
  {
    id: "files",
    href: "/attachments",
    target: ["attachments", "more"],
    title: "Attachments and Notes",
    points: [
      "Every file from email and WhatsApp in one place, so the signed offer is never lost in a chat.",
      "Notes, just below, keep your own notes with formatting and files.",
    ],
  },
  {
    id: "new",
    href: "/inbox",
    target: ["new", "more"],
    title: "Start Something New",
    points: [
      "New starts an email, a WhatsApp message or an event.",
      "Press ⌘K anywhere to search people and conversations.",
    ],
  },
  {
    id: "settings",
    href: "/settings/personalisation",
    target: ["settings", "more"],
    title: "Personalisation: What Konva Knows",
    points: [
      "What Konva wrote about you, how you write and who matters most. Change it any time and drafts follow.",
      "Add more accounts under Connected Accounts.",
    ],
  },
];

/** The first element on screen with one of these data-tour values. */
function findTarget(targets: string[]): HTMLElement | null {
  for (const t of targets) {
    for (const el of document.querySelectorAll<HTMLElement>(`[data-tour="${t}"]`)) {
      if (el.getClientRects().length > 0) return el;
    }
  }
  return null;
}

export function AppTour() {
  const meta = useOnboardingMeta();
  const router = useRouter();
  const pathname = usePathname();
  const [index, setIndex] = useState(0);
  const [ended, setEnded] = useState(false);
  const active = meta.tour === "pending" && (!meta.onboarding || meta.onboarding === "done") && !ended && pathname !== "/login";
  const stop = STOPS[index];

  // Ready to run again once this one is saved as done.
  useEffect(() => {
    if (meta.tour === "pending") return;
    setEnded(false);
    setIndex(0);
  }, [meta.tour]);

  // Each stop opens its page behind the card.
  useEffect(() => {
    if (active && !pathname.startsWith(stop.href)) router.push(stop.href);
  }, [active, stop, pathname, router]);

  // Marks where the page lives in the navigation, and finds it again when the rail and bottom bar swap.
  const marked = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (!active) return;
    const mark = () => {
      marked.current?.removeAttribute("data-tour-active");
      marked.current = findTarget(stop.target);
      marked.current?.setAttribute("data-tour-active", "");
    };
    mark();
    window.addEventListener("resize", mark);
    return () => { window.removeEventListener("resize", mark); marked.current?.removeAttribute("data-tour-active"); marked.current = null; };
  }, [active, stop]);

  if (!active) return null;

  const end = (outcome: "skipped" | "done") => {
    setEnded(true);
    track("tour_step", { step: stop.id, outcome });
    void saveOnboarding({ tour: "done" }).catch(() => undefined);
  };
  const last = index === STOPS.length - 1;
  const next = () => {
    if (last) return end("done");
    track("tour_step", { step: stop.id, outcome: "next" });
    setIndex(index + 1);
  };

  return (
    <div
      role="dialog"
      aria-modal="false"
      aria-labelledby="tour-title"
      onKeyDown={(e) => { if (e.key === "Escape") end("skipped"); }}
      className="fixed inset-x-3 bottom-[calc(4.25rem+env(safe-area-inset-bottom))] z-50 rounded-xl bg-popover text-sm text-popover-foreground shadow-lg ring-1 ring-foreground/10 md:inset-x-auto md:right-6 md:bottom-6 md:w-[26rem] animate-in fade-in-0 slide-in-from-bottom-2"
    >
      <div className="space-y-4 p-5">
        <div className="flex items-center gap-3">
          <Progress value={((index + 1) / STOPS.length) * 100} className="h-1 flex-1" aria-label={`Stop ${index + 1} of ${STOPS.length}`} />
          <span className="shrink-0 text-xs text-muted-foreground tabular-nums">{index + 1} of {STOPS.length}</span>
        </div>
        <div className="space-y-2">
          <h2 id="tour-title" className="text-base font-medium">{stop.title}</h2>
          <ul className="list-disc space-y-1.5 pl-4 text-muted-foreground marker:text-muted-foreground/50">
            {stop.points.map((p) => <li key={p}>{p}</li>)}
          </ul>
        </div>
      </div>
      <div className="flex items-center justify-between gap-2 rounded-b-xl border-t bg-muted/50 px-5 py-3">
        <Button variant="ghost" size="sm" onClick={() => end("skipped")}>{last ? "Close" : "End Tour"}</Button>
        <div className="flex gap-2">
          {index > 0 && <Button variant="outline" size="sm" onClick={() => setIndex(index - 1)}>Back</Button>}
          <Button size="sm" autoFocus onClick={next}>{last ? "Done" : "Next"}</Button>
        </div>
      </div>
    </div>
  );
}
