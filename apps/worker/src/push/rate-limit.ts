// A sliding-window limit on pushes per person, so a burst (a first sync, a noisy thread) cannot buzz a phone dozens
// of times. In memory: a restart forgets it, which is fine for a courtesy limit.

export class PushRateLimit {
  private readonly sent = new Map<string, number[]>();
  constructor(private readonly max = 6, private readonly windowMs = 10 * 60_000) {}

  /** Records a push and returns true, or returns false (and records nothing) when the person is at the limit. */
  take(userId: string, now = Date.now()): boolean {
    const recent = (this.sent.get(userId) ?? []).filter((t) => now - t < this.windowMs);
    if (recent.length >= this.max) { this.sent.set(userId, recent); return false; }
    recent.push(now);
    this.sent.set(userId, recent);
    return true;
  }
}
