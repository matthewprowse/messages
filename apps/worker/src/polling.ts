// Load control for the sync worker: how often to poll, when a heartbeat write is worth making, and how
// long to wait before retrying a file that could not be fetched. Pure logic with no database or env
// import, so it is testable on its own. Every interval can be set in apps/worker/.env.

function ms(name: string, fallback: number): number {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

export interface PollPlan {
  /** Delay while there has been activity recently. */
  activeMs: number;
  /** Delay once activity has been quiet for `activeWindowMs`. */
  idleMs: number;
  /** Delay once activity has been quiet for `deepIdleAfterMs`. */
  deepIdleMs: number;
  activeWindowMs: number;
  deepIdleAfterMs: number;
}

/** How long to wait before the next check, given when something last happened. */
export function nextPollDelay(now: number, lastActivity: number, plan: PollPlan): number {
  const quiet = now - lastActivity;
  if (quiet < plan.activeWindowMs) return plan.activeMs;
  if (quiet < plan.deepIdleAfterMs) return plan.idleMs;
  return plan.deepIdleMs;
}

/**
 * When the worker last saw work queued in the app (a reply, a mail action, a calendar change), which means
 * someone is using Konva right now. Only the queue safety-net poll in index.ts follows it; the mail and chat
 * connectors follow their own account's activity (AccountActivity below), so one busy mailbox never keeps
 * every other account on fast polling.
 */
class Activity {
  private last = Date.now();
  private readonly listeners = new Set<() => void>();
  mark(now = Date.now()) {
    this.last = now;
    for (const fn of this.listeners) fn();
  }
  since(): number { return this.last; }
  /** Calls `fn` on every mark (a sleeping poll uses it to wake early). Returns the way to stop. */
  onMark(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => void this.listeners.delete(fn);
  }
}
export const activity = new Activity();
export const markActivity = () => activity.mark();

/**
 * When each account last had something happen: mail or chats changed at the provider, or the app sent a
 * reply or applied an action for it. A connector reads its own account's quiet time to pick its next delay,
 * and is woken early when the app queues work for it. A new connector counts as active, so a fresh or
 * restarted account is checked quickly at first.
 */
export class AccountActivity {
  private readonly last = new Map<string, number>();
  private readonly listeners = new Map<string, Set<() => void>>();
  mark(accountId: string, now = Date.now()) {
    this.last.set(accountId, now);
    for (const fn of this.listeners.get(accountId) ?? []) fn();
  }
  since(accountId: string, now = Date.now()): number {
    return this.last.get(accountId) ?? now;
  }
  /** How long to wait before this account's next check under `plan`. */
  delay(accountId: string, plan: PollPlan, now = Date.now()): number {
    return nextPollDelay(now, this.since(accountId, now), plan);
  }
  /** Calls `fn` on every mark for this account. Returns the way to stop. */
  onMark(accountId: string, fn: () => void): () => void {
    const set = this.listeners.get(accountId) ?? new Set();
    set.add(fn);
    this.listeners.set(accountId, set);
    return () => {
      set.delete(fn);
      if (set.size === 0 && this.listeners.get(accountId) === set) this.listeners.delete(accountId);
    };
  }
  /** Drops an account that stopped, so the maps do not grow with every account ever connected. */
  forget(accountId: string) {
    this.last.delete(accountId);
  }
}
export const accountActivity = new AccountActivity();

/**
 * Gmail has no push without Google Cloud Pub/Sub, so it is checked on a timer that backs off when quiet:
 * every 5 s for 10 minutes after something happens in that mailbox (or the app acts on it), then every
 * 30 s, then every 60 s once it has been quiet for an hour.
 */
export const GMAIL_POLL: PollPlan = {
  activeMs: ms("GMAIL_POLL_ACTIVE_MS", 5_000),
  idleMs: ms("GMAIL_POLL_IDLE_MS", 30_000),
  deepIdleMs: ms("GMAIL_POLL_DEEP_IDLE_MS", 60_000),
  activeWindowMs: ms("POLL_ACTIVE_WINDOW_MS", 10 * 60_000),
  deepIdleAfterMs: ms("POLL_DEEP_IDLE_AFTER_MS", 60 * 60_000),
};

/** Outlook's Inbox delta check: the same shape as Gmail's, on its own account's activity. */
export const OUTLOOK_POLL: PollPlan = { ...GMAIL_POLL };

/** Outlook's other folders (Sent, Archive, Junk, Deleted): read far less often than the Inbox once quiet. */
export const OUTLOOK_SIDE_POLL: PollPlan = {
  activeMs: ms("OUTLOOK_SIDE_ACTIVE_MS", 20_000),
  idleMs: ms("OUTLOOK_SIDE_IDLE_MS", 2 * 60_000),
  deepIdleMs: ms("OUTLOOK_SIDE_DEEP_IDLE_MS", 5 * 60_000),
  activeWindowMs: GMAIL_POLL.activeWindowMs,
  deepIdleAfterMs: GMAIL_POLL.deepIdleAfterMs,
};

/** Teams has no push here, so the chat list is polled: 15 s while chats are moving, then 30 s, then 60 s. */
export const TEAMS_POLL: PollPlan = {
  activeMs: ms("TEAMS_POLL_ACTIVE_MS", 15_000),
  idleMs: ms("TEAMS_POLL_IDLE_MS", 30_000),
  deepIdleMs: ms("TEAMS_POLL_DEEP_IDLE_MS", 60_000),
  activeWindowMs: GMAIL_POLL.activeWindowMs,
  deepIdleAfterMs: GMAIL_POLL.deepIdleAfterMs,
};

/**
 * The queue safety-net poll. Realtime delivers queued work at once, and index.ts reads the queues once
 * more every time the channel (re)subscribes, which is the real gap; this only catches an event that was
 * missed some other way. Every 60 s while the app was used in the last 10 minutes, every 5 minutes otherwise.
 */
export const QUEUE_POLL: PollPlan = {
  activeMs: ms("QUEUE_POLL_ACTIVE_MS", 60_000),
  idleMs: ms("QUEUE_POLL_IDLE_MS", 5 * 60_000),
  deepIdleMs: ms("QUEUE_POLL_DEEP_IDLE_MS", 5 * 60_000),
  activeWindowMs: GMAIL_POLL.activeWindowMs,
  deepIdleAfterMs: GMAIL_POLL.deepIdleAfterMs,
};

/** Every account's heartbeat (accounts.last_synced_at) is written at most this often. */
export const HEARTBEAT_MS = ms("ACCOUNT_HEARTBEAT_MS", 15 * 60_000);

/** Decides whether a heartbeat write is due. One per process; remembers the last write per account. */
export class HeartbeatGate {
  private readonly last = new Map<string, number>();
  constructor(private readonly everyMs = HEARTBEAT_MS) {}

  /** True when a write is due, and records it as made. */
  due(accountId: string, now = Date.now()): boolean {
    const before = this.last.get(accountId);
    if (before !== undefined && now - before < this.everyMs) return false;
    this.last.set(accountId, now);
    return true;
  }

  /** A write made for another reason (a status change) counts as a heartbeat too. */
  wrote(accountId: string, now = Date.now()) { this.last.set(accountId, now); }

  /** A failed write must not hold the next one off. */
  forget(accountId: string) { this.last.delete(accountId); }
}

/** Attachment files that cannot be fetched: tries before giving up for good, and the delay after each. */
export const FILE_MAX_TRIES = ms("FILE_FETCH_MAX_TRIES", 6);
const FILE_BASE_MS = ms("FILE_FETCH_BASE_MS", 10 * 60_000);
const FILE_CAP_MS = 24 * 60 * 60_000;

/** After the nth failed try (1 based): when to try again, or null once it should be given up on. */
export function fileRetryDelay(tries: number, maxTries = FILE_MAX_TRIES, baseMs = FILE_BASE_MS): number | null {
  if (tries >= maxTries) return null;
  return Math.min(FILE_CAP_MS, baseMs * 2 ** (tries - 1));
}
