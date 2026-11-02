// Creates and renews an account's Graph mail subscription. The client is passed in as a type with one method, so tests
// use a fake and never reach Microsoft. A subscription that Graph no longer knows (404) is created again; any other
// failure is thrown for the connector to treat as "push is failing".

import { GraphApiError } from "./client";
import { SUBSCRIPTION_LIFETIME_MS, renewalDue, subscriptionBody, type SavedSubscription } from "./graph-notify";

export interface GraphLike {
  request<T = unknown>(path: string, opts?: { method?: string; body?: unknown }): Promise<T>;
}

/** Keeps `saved` alive: nothing to do while it has time left, a renewal when it is near its end, a new one when it is gone. */
export async function ensureMailSubscription(
  client: GraphLike,
  opts: { accountId: string; url: string; secret: string; saved: SavedSubscription | null; now?: number },
): Promise<{ sub: SavedSubscription; changed: boolean }> {
  const now = opts.now ?? Date.now();
  if (opts.saved && !renewalDue(opts.saved, now)) return { sub: opts.saved, changed: false };
  if (opts.saved) {
    const expiresAt = now + SUBSCRIPTION_LIFETIME_MS;
    try {
      await client.request(`/subscriptions/${encodeURIComponent(opts.saved.id)}`, { method: "PATCH", body: { expirationDateTime: new Date(expiresAt).toISOString() } });
      return { sub: { id: opts.saved.id, expiresAt }, changed: true };
    } catch (err) {
      if (!(err instanceof GraphApiError) || err.status !== 404) throw err;
    }
  }
  const made = await client.request<{ id: string; expirationDateTime?: string }>("/subscriptions", { method: "POST", body: subscriptionBody({ ...opts, now }) });
  const expiresAt = made.expirationDateTime ? Date.parse(made.expirationDateTime) : now + SUBSCRIPTION_LIFETIME_MS;
  return { sub: { id: made.id, expiresAt: Number.isFinite(expiresAt) ? expiresAt : now + SUBSCRIPTION_LIFETIME_MS }, changed: true };
}
