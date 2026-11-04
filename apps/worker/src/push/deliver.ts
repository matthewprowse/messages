// Sends one payload to every device a person has subscribed, and says which subscriptions have expired. The web-push
// call is passed in so tests never contact a push service; sender.ts passes the real one. Only known push services are
// posted to (endpoint.ts), each send has a hard time limit, and a person's devices are sent to a few at a time.

import { mapLimit } from "../util";
import { isPushServiceEndpoint } from "./endpoint";
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
  /** Endpoints that are not a known push service: never contacted. */
  refused: number;
}

const TTL_S = 60 * 60; // a push that cannot be delivered within an hour is stale
/** A push service answers in well under a second; one that has not answered by now is given up on. */
export const SEND_TIMEOUT_MS = 10_000;
const DEVICES_AT_ONCE = 4;

/** A 404 or 410 means the browser dropped the subscription for good; anything else may be a passing fault. */
export function isExpired(err: unknown): boolean {
  const code = (err as { statusCode?: unknown } | null)?.statusCode;
  return code === 404 || code === 410;
}

/** Rejects with code TIMEOUT once ms pass. The send itself is not cancelled here (the socket timeout ends it). */
export function withTimeout<T>(work: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const late = new Promise<never>((_, reject) => { timer = setTimeout(() => reject(Object.assign(new Error("push send timed out"), { code: "TIMEOUT" })), ms); });
  return Promise.race([work, late]).finally(() => clearTimeout(timer));
}

/** Delivers to each subscription independently, so one dead or slow device never blocks the others. */
export async function deliver(subs: PushSubscriptionRow[], payload: PushPayload, kind: PushKind, send: SendFn, timeoutMs = SEND_TIMEOUT_MS): Promise<DeliveryResult> {
  const out: DeliveryResult = { sent: 0, expired: [], failed: 0, refused: 0 };
  const body = JSON.stringify(payload);
  const allowed = subs.filter((s) => isPushServiceEndpoint(s.endpoint));
  out.refused = subs.length - allowed.length;
  await mapLimit(allowed, DEVICES_AT_ONCE, async (s) => {
    try {
      await withTimeout(send({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, body, { TTL: TTL_S, urgency: kind === "urgent" ? "high" : "normal" }), timeoutMs);
      out.sent++;
    } catch (err) {
      if (isExpired(err)) out.expired.push(s.id);
      else out.failed++;
    }
  });
  return out;
}
