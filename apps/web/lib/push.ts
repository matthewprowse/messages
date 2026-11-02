// Pure parts of web push and the app badge: can this device receive push and what should the button say, the subscription
// as a push_subscriptions row, the VAPID key as bytes, and the unread count for the badge. No browser calls here, so it
// is testable; use-push.ts does the browser and database work.

import type { Thread } from "./types";

export type PushAvailability =
  | "unsupported" // no service worker, push or notifications in this browser
  | "needs-install" // iPhone and iPad only deliver push to an app added to the Home Screen
  | "unconfigured" // this deployment has no VAPID public key
  | "blocked" // the person denied notifications in the browser
  | "ready";

export interface PushEnv {
  hasServiceWorker: boolean;
  hasPushManager: boolean;
  hasNotification: boolean;
  /** Opened as an installed app (display-mode: standalone, or navigator.standalone on iOS). */
  standalone: boolean;
  /** iPhone or iPad (including iPadOS, which calls itself a Mac with a touch screen). */
  ios: boolean;
  permission: NotificationPermission | "unavailable";
  vapidKey: string;
}

/** Whether this device can turn push on, in the order the person would fix things. */
export function pushAvailability(e: PushEnv): PushAvailability {
  if (!e.hasServiceWorker || !e.hasNotification) return e.ios && !e.standalone ? "needs-install" : "unsupported";
  if (e.ios && !e.standalone) return "needs-install";
  if (!e.hasPushManager) return "unsupported";
  if (!e.vapidKey) return "unconfigured";
  if (e.permission === "denied") return "blocked";
  return "ready";
}

/** The VAPID public key (URL-safe base64) as the bytes pushManager.subscribe wants. */
export function vapidKeyBytes(key: string): Uint8Array<ArrayBuffer> {
  const b64 = key.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(key.length / 4) * 4, "=");
  const raw = atob(b64);
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

export interface PushSubscriptionRowInput {
  user_id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
  user_agent: string | null;
}

/** A subscription as a database row, or null when the browser gave no keys (it then cannot be pushed to). */
export function subscriptionRow(json: { endpoint?: string; keys?: { p256dh?: string; auth?: string } }, userId: string, userAgent: string): PushSubscriptionRowInput | null {
  const { endpoint, keys } = json;
  if (!endpoint || !keys?.p256dh || !keys.auth) return null;
  return { user_id: userId, endpoint, p256dh: keys.p256dh, auth: keys.auth, user_agent: userAgent.slice(0, 200) || null };
}

/** The unread count for the app icon: conversations in the inbox with something new from someone else, junk left out. */
export function badgeCount(threads: Pick<Thread, "status" | "junk" | "unread" | "lastFromMe">[]): number {
  let n = 0;
  for (const t of threads) if (t.status === "inbox" && !t.junk && t.unread && !t.lastFromMe) n++;
  return n;
}
