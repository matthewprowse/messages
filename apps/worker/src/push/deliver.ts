// Sends one payload to every device a person has subscribed, and says which subscriptions have expired. The web-push
// call is passed in so tests never contact a push service; sender.ts passes the real one.

import type { PushPayload } from "./payload";
import type { PushKind } from "./policy";

export interface PushSubscriptionRow {
  id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
}

/** The slice of web-push's sendNotification this module needs. Rejects with an error carrying `statusCode`. */
export type SendFn = (sub: { endpoint: string; keys: { p256dh: string; auth: string } }, body: string, options: { TTL: number; urgency: "normal" | "high" }) => Promise<unknown>;

export interface DeliveryResult {
  sent: number;
  /** Subscriptions the push service no longer knows (404 or 410): the sender deletes them. */
  expired: string[];
  failed: number;
}

const TTL_S = 60 * 60; // a push that cannot be delivered within an hour is stale

/** A 404 or 410 means the browser dropped the subscription for good; anything else may be a passing fault. */
export function isExpired(err: unknown): boolean {
  const code = (err as { statusCode?: unknown } | null)?.statusCode;
  return code === 404 || code === 410;
}

/** Delivers to each subscription independently, so one dead device never blocks the others. */
export async function deliver(subs: PushSubscriptionRow[], payload: PushPayload, kind: PushKind, send: SendFn): Promise<DeliveryResult> {
  const out: DeliveryResult = { sent: 0, expired: [], failed: 0 };
  const body = JSON.stringify(payload);
  for (const s of subs) {
    try {
      await send({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, body, { TTL: TTL_S, urgency: kind === "urgent" ? "high" : "normal" });
      out.sent++;
    } catch (err) {
      if (isExpired(err)) out.expired.push(s.id);
      else out.failed++;
    }
  }
  return out;
}
