// The pure side of Gmail push: reading a Pub/Sub notification, deciding whether it is news, when to renew the
// watch, and which connector to wake. Gmail publishes {emailAddress, historyId} to a Pub/Sub topic whenever a
// mailbox changes; the worker pulls it (runtime/gmail-push.ts) and wakes the connector for that mailbox, which then
// reads history.list from its own stored historyId. The notification's historyId is only a hint: the stored one is
// the cursor, so a late, repeated or out of order notification can never make the connector skip or repeat changes.

/** Renew the watch this often. Gmail expires a watch after 7 days; daily means a few missed renewals still leave it alive. */
export const WATCH_RENEW_EVERY_MS = 24 * 60 * 60_000;
/** A watch this close to expiring is renewed whatever its age (a clock jump, a long outage). */
const WATCH_EXPIRY_MARGIN_MS = 2 * 60 * 60_000;

export interface GmailNotification {
  /** Lower case. Used only to find the connector in memory; never logged or stored. */
  address: string;
  historyId: string;
}

/** Reads a Pub/Sub message's base64 data. Null for anything that is not a Gmail mailbox notification. */
export function parseGmailNotification(data: string | undefined): GmailNotification | null {
  if (!data) return null;
  try {
    const body = JSON.parse(Buffer.from(data, "base64").toString("utf8")) as { emailAddress?: unknown; historyId?: unknown };
    const address = typeof body.emailAddress === "string" ? body.emailAddress.trim().toLowerCase() : "";
    const historyId = typeof body.historyId === "number" || typeof body.historyId === "string" ? String(body.historyId) : "";
    if (!address.includes("@") || !/^\d+$/.test(historyId)) return null;
    return { address, historyId };
  } catch {
    return null;
  }
}

/** Whether history id `a` is later than `b`. History ids are numbers too big to trust to a double. A missing or unreadable `b` counts as older. */
export function historyIsNewer(a: string, b: string | null): boolean {
  if (!/^\d+$/.test(a)) return false;
  if (b === null || !/^\d+$/.test(b)) return true;
  return BigInt(a) > BigInt(b);
}

/** Whether a notification is news for a connector whose stored cursor is `stored`: only a later history id is. */
export function shouldWake(notified: string, stored: string | null): boolean {
  return historyIsNewer(notified, stored);
}

export interface WatchState {
  /** When Gmail says the watch ends, in ms since the epoch. */
  expiresAt: number;
  /** When this process last started or renewed it. */
  renewedAt: number;
}

/** Whether the watch needs starting or renewing now. */
export function watchDue(watch: WatchState | null, now: number, everyMs = WATCH_RENEW_EVERY_MS): boolean {
  if (!watch) return true;
  if (now >= watch.expiresAt - WATCH_EXPIRY_MARGIN_MS) return true;
  return now - watch.renewedAt >= everyMs;
}

/** Reads users.watch's reply. Null when it lacks a usable expiry. */
export function parseWatchReply(reply: { historyId?: string; expiration?: string | number }, now: number): WatchState | null {
  const expiresAt = Number(reply.expiration);
  if (!Number.isFinite(expiresAt) || expiresAt <= now) return null;
  return { expiresAt, renewedAt: now };
}

/**
 * The connectors in this process by mailbox address, so a notification finds the right one. An address can belong
 * to more than one account (two people who both connected it), so each address holds several. Memory only.
 */
export class PushRouter {
  private readonly byAddress = new Map<string, Map<string, (historyId: string) => void>>();

  /** Registers an account's wake function. Returns the way to remove it. */
  register(address: string, accountId: string, wake: (historyId: string) => void): () => void {
    const key = address.trim().toLowerCase();
    const set = this.byAddress.get(key) ?? new Map<string, (historyId: string) => void>();
    set.set(accountId, wake);
    this.byAddress.set(key, set);
    return () => {
      const current = this.byAddress.get(key);
      if (current?.get(accountId) === wake) current.delete(accountId);
      if (current && current.size === 0) this.byAddress.delete(key);
    };
  }

  /** Wakes every connector for the address. Returns how many there were: zero means this process does not own it. */
  route(n: GmailNotification): number {
    const set = this.byAddress.get(n.address);
    if (!set) return 0;
    for (const wake of set.values()) wake(n.historyId);
    return set.size;
  }
}
