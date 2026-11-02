"use client";

// Mounted once in the app shell. Registers the service worker (so a push can arrive when the app is closed) and keeps
// the app icon's badge in step with the unread count where the browser supports it. Renders nothing.

import { useEffect } from "react";
import { useApp } from "@/lib/store";
import { badgeCount } from "@/lib/push";
import { registerServiceWorker } from "@/lib/use-push";

export function PwaBoot() {
  const { threads } = useApp();
  useEffect(() => { void registerServiceWorker(); }, []);
  const count = badgeCount(threads);
  useEffect(() => {
    const nav = navigator as Navigator & { setAppBadge?: (n?: number) => Promise<void>; clearAppBadge?: () => Promise<void> };
    if (!nav.setAppBadge) return;
    // Badging can reject (no permission, or not installed); the badge is a nicety, so it is ignored.
    (count > 0 ? nav.setAppBadge(count) : nav.clearAppBadge?.())?.catch(() => undefined);
  }, [count]);
  return null;
}
