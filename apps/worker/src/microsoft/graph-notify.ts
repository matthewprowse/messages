// The pure side of Outlook push: the clientState that proves a Graph notification is for one of our accounts, how long a
// mail subscription lives, when to renew it, and how it is remembered between sessions.
//
// Graph posts a change notification to the web app's public route (apps/web/app/api/graph/notify), which cannot trust
// the caller by address. Every subscription is created with a clientState the route checks: the account id and an HMAC
// of it under GRAPH_NOTIFY_SECRET (the same value in the web app and here), so a forged notification cannot make the
// route write a hint for an account, and the route needs no database lookup to validate one. The same function is in
// apps/web/lib/server/graph-notify.ts; both are tested against one fixed value so they cannot drift.

import { createHmac, timingSafeEqual } from "node:crypto";

/** Graph lets a mail subscription last 4230 minutes (just under 3 days). Ask for slightly less. */
export const SUBSCRIPTION_LIFETIME_MS = 4_000 * 60_000;
/** Renew once the subscription has this little time left, so a renewal that fails still has retries before expiry. */
export const SUBSCRIPTION_RENEW_LEAD_MS = 48 * 60 * 60_000;

function mac(accountId: string, secret: string): string {
  return createHmac("sha256", secret).update(`graph-notify:${accountId}`).digest("base64url");
}

/** The clientState for an account's subscription: "<account id>.<hmac>", 80 characters (Graph allows 128). */
export function clientStateFor(accountId: string, secret: string): string {
  return `${accountId}.${mac(accountId, secret)}`;
}

/** The account id a clientState was made for, or null when it is not one of ours. */
export function accountFromClientState(state: unknown, secret: string): string | null {
  if (typeof state !== "string" || state.length > 128) return null;
  const dot = state.indexOf(".");
  if (dot < 1) return null;
  const accountId = state.slice(0, dot);
  if (!/^[0-9a-f-]{36}$/i.test(accountId)) return null;
  const given = Buffer.from(state.slice(dot + 1));
  const want = Buffer.from(mac(accountId, secret));
  return given.length === want.length && timingSafeEqual(given, want) ? accountId : null;
}

/** A subscription as remembered in sync_state.sync_token: its Graph id and when it ends. */
export interface SavedSubscription {
  id: string;
  expiresAt: number;
}

export function formatSubscription(sub: SavedSubscription): string {
  return `${sub.id}|${sub.expiresAt}`;
}

export function parseSubscription(token: string | null | undefined): SavedSubscription | null {
  if (!token) return null;
  const [id, at] = token.split("|");
  const expiresAt = Number(at);
  return id && Number.isFinite(expiresAt) ? { id, expiresAt } : null;
}

/** Whether a subscription needs renewing now (or is gone). */
export function renewalDue(sub: SavedSubscription | null, now: number, leadMs = SUBSCRIPTION_RENEW_LEAD_MS): boolean {
  return !sub || sub.expiresAt - now <= leadMs;
}

/** The body for creating a mail subscription. */
export function subscriptionBody(opts: { accountId: string; url: string; secret: string; now: number }) {
  return {
    changeType: "created,updated,deleted",
    notificationUrl: opts.url,
    resource: "me/messages",
    expirationDateTime: new Date(opts.now + SUBSCRIPTION_LIFETIME_MS).toISOString(),
    clientState: clientStateFor(opts.accountId, opts.secret),
  };
}
