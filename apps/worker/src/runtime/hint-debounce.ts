// Coalesces a burst of "sync this account now" hints. Graph sends a notification per changed message, so a newsletter
// run or a folder move is dozens in a second, and each sync would read the same delta. The first hint fires at once
// (new mail should not wait); hints that follow within the window become one more fire when the window ends, so the
// last change is never missed. Timers and the clock are passed in so tests run without waiting.

export interface Timers {
  set(fn: () => void, ms: number): unknown;
  clear(handle: unknown): void;
}

const realTimers: Timers = {
  set: (fn, ms) => { const t = setTimeout(fn, ms); t.unref(); return t; },
  clear: (h) => clearTimeout(h as NodeJS.Timeout),
};

export class HintDebouncer {
  private readonly lastFire = new Map<string, number>();
  private readonly pending = new Map<string, unknown>();

  constructor(
    private readonly fire: (accountId: string) => void,
    private readonly windowMs = 3_000,
    private readonly now: () => number = Date.now,
    private readonly timers: Timers = realTimers,
  ) {}

  hint(accountId: string) {
    if (this.pending.has(accountId)) return; // a trailing fire is already booked and will cover this hint
    const since = this.now() - (this.lastFire.get(accountId) ?? -Infinity);
    if (since >= this.windowMs) return this.go(accountId);
    this.pending.set(accountId, this.timers.set(() => { this.pending.delete(accountId); this.go(accountId); }, this.windowMs - since));
  }

  private go(accountId: string) {
    this.lastFire.set(accountId, this.now());
    this.fire(accountId);
  }

  /** Drops an account that stopped, so the maps do not grow with every account ever seen. */
  forget(accountId: string) {
    const handle = this.pending.get(accountId);
    if (handle !== undefined) this.timers.clear(handle);
    this.pending.delete(accountId);
    this.lastFire.delete(accountId);
  }
}
