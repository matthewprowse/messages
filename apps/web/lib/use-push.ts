"use client";

// Turning web push on and off for this device: registers the service worker, asks permission, subscribes with the VAPID
// public key and saves the subscription to push_subscriptions (row-level security keeps it to the signed-in person).
// The decisions about what is possible live in lib/push.ts; the worker (apps/worker/src/push) does the sending.

import { useCallback, useEffect, useState } from "react";
import { supabase } from "./supabase";
import { useAuth } from "./auth";
import { pushAvailability, subscriptionRow, vapidKeyBytes, type PushAvailability, type PushEnv } from "./push";

const VAPID_KEY = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? "";

/** Registers the service worker once. It has no fetch handler, so it never sees (or caches) a page or API response. */
export function registerServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return Promise.resolve(null);
  return navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(() => null);
}

function readEnv(): PushEnv {
  const nav = navigator as Navigator & { standalone?: boolean };
  return {
    hasServiceWorker: "serviceWorker" in navigator,
    hasPushManager: "PushManager" in window,
    hasNotification: "Notification" in window,
    standalone: window.matchMedia("(display-mode: standalone)").matches || nav.standalone === true,
    ios: /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1),
    permission: "Notification" in window ? Notification.permission : "unavailable",
    vapidKey: VAPID_KEY,
  };
}

export interface PushControl {
  /** undefined until the browser has been asked. */
  availability: PushAvailability | undefined;
  /** This device is subscribed and the subscription is saved for the signed-in person. */
  on: boolean;
  busy: boolean;
  /** Resolves to an error sentence for a toast, or null on success. */
  enable: () => Promise<string | null>;
  disable: () => Promise<string | null>;
}

export function usePush(): PushControl {
  const { session } = useAuth();
  const userId = session?.user.id;
  const [availability, setAvailability] = useState<PushAvailability>();
  const [on, setOn] = useState(false);
  const [busy, setBusy] = useState(false);

  // Is this browser already subscribed, and is that subscription saved for this person? (A shared device may hold another person's.)
  const refresh = useCallback(async () => {
    const avail = pushAvailability(readEnv());
    setAvailability(avail);
    if (!userId || (avail !== "ready" && avail !== "blocked")) return setOn(false);
    const reg = await navigator.serviceWorker.getRegistration("/");
    const sub = await reg?.pushManager.getSubscription();
    if (!sub) return setOn(false);
    const { data } = await supabase.from("push_subscriptions").select("id").eq("user_id", userId).eq("endpoint", sub.endpoint).maybeSingle();
    setOn(!!data);
  }, [userId]);
  useEffect(() => { void refresh(); }, [refresh]);

  const enable = useCallback(async (): Promise<string | null> => {
    if (!userId) return "Sign in first";
    setBusy(true);
    try {
      if (pushAvailability(readEnv()) !== "ready") return "Push is not available on this device";
      if ((await Notification.requestPermission()) !== "granted") { await refresh(); return "Push was not allowed"; }
      const reg = (await registerServiceWorker()) && (await navigator.serviceWorker.ready);
      if (!reg) return "Push could not start on this device";
      // Always a fresh subscription: an old one may belong to someone else who used this browser, and its address is unique.
      await (await reg.pushManager.getSubscription())?.unsubscribe();
      const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: vapidKeyBytes(VAPID_KEY) });
      const row = subscriptionRow(sub.toJSON(), userId, navigator.userAgent);
      if (!row) { await sub.unsubscribe(); return "Push could not start on this device"; }
      const { error } = await supabase.from("push_subscriptions").upsert(row, { onConflict: "endpoint" });
      if (error) { await sub.unsubscribe(); return "Could not save push. Try again"; }
      setOn(true);
      return null;
    } catch {
      return "Push could not start on this device";
    } finally {
      setBusy(false);
    }
  }, [userId, refresh]);

  const disable = useCallback(async (): Promise<string | null> => {
    setBusy(true);
    try {
      const reg = await navigator.serviceWorker.getRegistration("/");
      const sub = await reg?.pushManager.getSubscription();
      if (sub && userId) await supabase.from("push_subscriptions").delete().eq("user_id", userId).eq("endpoint", sub.endpoint);
      await sub?.unsubscribe();
      setOn(false);
      return null;
    } catch {
      return "Could not turn push off";
    } finally {
      setBusy(false);
    }
  }, [userId]);

  return { availability, on, busy, enable, disable };
}
