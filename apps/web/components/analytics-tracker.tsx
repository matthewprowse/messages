"use client";

// Mounted once in the app. Feeds lib/analytics with screen changes, screen time, errors and rage clicks.
// Content-free by design: it records names the code gave things, never text the user typed or read.

import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import { wordOf } from "@messages/analytics";
import { useAuth } from "@/lib/auth";
import { useApp } from "@/lib/store";
import { currentScreen, flush, screenOf, setScreen, setSharing, track } from "@/lib/analytics";

const RAGE_CLICKS = 3;
const RAGE_MS = 1500;
const MAX_SCREEN_SECS = 1800;
/** Looking at the analytics is not product use, and signing in is not a screen of the product. */
const UNTRACKED = new Set(["analytics", "login"]);

/** What was clicked, as a name the code gave it (data-analytics, else the component's own slot), never the words on it. */
function targetOf(el: Element | null): string | undefined {
  const hit = el?.closest("[data-analytics], [data-slot], button, a, [role=button]");
  if (!hit) return undefined;
  return wordOf(hit.getAttribute("data-analytics")) ?? wordOf(hit.getAttribute("data-slot")) ?? wordOf(hit.tagName);
}

/** Time shown on a screen, filed under that screen. Under a second is a pass-through, not a visit. */
function trackTime(screen: string, secs: number) {
  if (screen && secs >= 1 && !UNTRACKED.has(screen)) track("screen_time", { secs: Math.min(MAX_SCREEN_SECS, Math.round(secs)) }, screen);
}

// Records which screen is open and for how long, errors and repeated clicks. Renders nothing.
export function AnalyticsTracker() {
  const pathname = usePathname();
  const { session } = useAuth();
  const { profile, loading } = useApp();
  const signedIn = !!session;
  const entered = useRef<{ screen: string; visible: number; since: number | null }>({ screen: "", visible: 0, since: null });
  const opened = useRef(false);

  useEffect(() => {
    setSharing(signedIn && profile.shareUsage);
  }, [signedIn, profile.shareUsage]);

  // The time on the screen being left, counting only while the tab is showing.
  const leave = () => {
    const e = entered.current;
    if (!e.screen) return;
    trackTime(e.screen, e.visible + (e.since === null ? 0 : (performance.now() - e.since) / 1000));
    entered.current = { screen: "", visible: 0, since: null };
  };

  useEffect(() => {
    if (!signedIn) return;
    if (!opened.current) {
      opened.current = true;
      let returning = false;
      try {
        returning = localStorage.getItem("seen") === "1";
        localStorage.setItem("seen", "1");
      } catch {
        // Private windows: counted as new each time.
      }
      track("app_open", { returning });
    }
    const next = screenOf(pathname);
    if (next === entered.current.screen) return;
    leave();
    setScreen(next);
    entered.current = { screen: next, visible: 0, since: document.visibilityState === "visible" ? performance.now() : null };
    if (!UNTRACKED.has(next)) track("screen_view", {}, next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname, signedIn]);

  // How long the first list takes to appear after the app opens.
  const timed = useRef(false);
  useEffect(() => {
    if (!signedIn || loading || timed.current) return;
    timed.current = true;
    track("load_timing", { what: "conversation_list", ms: Math.round(performance.now()) });
  }, [signedIn, loading]);

  useEffect(() => {
    const onVisibility = () => {
      const e = entered.current;
      if (document.visibilityState === "hidden") {
        if (e.since !== null) e.visible += (performance.now() - e.since) / 1000;
        e.since = null;
        trackTime(e.screen, e.visible);
        e.visible = 0;
        void flush();
      } else if (e.screen) {
        e.since = performance.now();
      }
    };
    document.addEventListener("visibilitychange", onVisibility);

    const onError = (event: ErrorEvent | PromiseRejectionEvent) => {
      const reason = event instanceof ErrorEvent ? event.error : event.reason;
      track("error", { code: wordOf(reason instanceof Error ? reason.name : undefined) ?? "unknown", where: currentScreen() || "unknown" });
    };
    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onError);

    let clicks: { target: string; at: number }[] = [];
    const onClick = (event: MouseEvent) => {
      const target = targetOf(event.target as Element | null);
      if (!target) return;
      const now = performance.now();
      clicks = [...clicks.filter((c) => c.target === target && now - c.at < RAGE_MS), { target, at: now }];
      if (clicks.length === RAGE_CLICKS) {
        track("rage_click", { target });
        clicks = [];
      }
    };
    document.addEventListener("click", onClick, true);

    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onError);
      document.removeEventListener("click", onClick, true);
    };
  }, []);

  return null;
}
