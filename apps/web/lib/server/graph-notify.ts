// Checks a Microsoft Graph change notification before the route writes anything. Every subscription the worker creates
// carries a clientState of "<account id>.<hmac>" (HMAC-SHA256 of "graph-notify:<account id>" under GRAPH_NOTIFY_SECRET,
// base64url), so a notification proves which account it is for without a database lookup, and a forged one is dropped.
// The worker has the same function in apps/worker/src/microsoft/graph-notify.ts; both tests pin one fixed value.
// Nothing here reads a message: a notification names a change, and the route stores only the account id.

import { createHmac, timingSafeEqual } from "node:crypto";

/** Most accounts one request may hint. Graph batches many changes, but they are all one mailbox. */
const MAX_ACCOUNTS = 50;

function mac(accountId: string, secret: string): string {
  return createHmac("sha256", secret).update(`graph-notify:${accountId}`).digest("base64url");
}

/** The account id a clientState was made for, or null when it is not valid. */
export function accountFromClientState(state: unknown, secret: string): string | null {
  if (!secret || typeof state !== "string" || state.length > 128) return null;
  const dot = state.indexOf(".");
  if (dot < 1) return null;
  const accountId = state.slice(0, dot);
  if (!/^[0-9a-f-]{36}$/i.test(accountId)) return null;
  const given = Buffer.from(state.slice(dot + 1));
  const want = Buffer.from(mac(accountId, secret));
  return given.length === want.length && timingSafeEqual(given, want) ? accountId : null;
}

/** For tests and tooling: the clientState the worker makes. */
export function clientStateFor(accountId: string, secret: string): string {
  return `${accountId}.${mac(accountId, secret)}`;
}

/** The distinct accounts a notification body is validly about. Anything malformed or unsigned is ignored. */
export function accountsToHint(body: unknown, secret: string): string[] {
  const value = (body as { value?: unknown } | null)?.value;
  if (!Array.isArray(value)) return [];
  const ids = new Set<string>();
  for (const item of value) {
    const id = accountFromClientState((item as { clientState?: unknown } | null)?.clientState, secret);
    if (id) ids.add(id);
    if (ids.size >= MAX_ACCOUNTS) break;
  }
  return [...ids];
}
