// Exponential backoff with jitter for reconnects: 1s, 2s, 4s ... capped at 5 minutes.
export class Backoff {
  private attempt = 0;
  constructor(private readonly baseMs = 1_000, private readonly maxMs = 5 * 60_000) {}

  next(): number {
    const delay = Math.min(this.maxMs, this.baseMs * 2 ** this.attempt);
    this.attempt++;
    return Math.round(delay * (0.8 + Math.random() * 0.4));
  }

  reset() {
    this.attempt = 0;
  }
}

export const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Runs steps one at a time, in the order they were added: IMAP commands that must not overlap, or
 * messages that must be stored in order. A step that fails does not stop the ones after it.
 */
export class SerialQueue {
  private tail: Promise<void> = Promise.resolve();

  /** Adds a step and resolves (or rejects) when it has run. */
  run(step: () => Promise<void>): Promise<void> {
    const result = this.tail.then(step);
    this.tail = result.catch(() => undefined);
    return result;
  }

  /** Adds a step nobody waits for. Its failure goes to onError instead of becoming an unhandled rejection. */
  background(step: () => Promise<void>, onError: (err: unknown) => void) {
    this.run(step).catch(onError);
  }

  /** Forgets queued work, for a fresh connection. Steps already running finish on their own. */
  reset() {
    this.tail = Promise.resolve();
  }
}

/** A wait that stop() can cut short, so a connector waiting out a backoff stops at once. */
export class Sleeper {
  private wake: (() => void) | null = null;

  wait(ms: number): Promise<void> {
    return new Promise<void>((resolve) => {
      // An interrupted wait clears its timer, so a stopped connector leaves nothing pending behind.
      const done = () => {
        clearTimeout(timer);
        if (this.wake === done) this.wake = null;
        resolve();
      };
      const timer = setTimeout(done, ms);
      this.wake = done;
    });
  }

  interrupt() {
    this.wake?.();
  }
}

/**
 * Runs a background job a while after start, then every interval, never two runs at once. Timers are
 * unref'd so they never hold the process open on shutdown. onError gets a run's failure.
 */
export function startEvery(firstMs: number, everyMs: number, job: () => Promise<unknown>, onError: (err: unknown) => void) {
  let running = false;
  const run = () => {
    if (running) return;
    running = true;
    job()
      .catch(onError)
      .finally(() => {
        running = false;
      });
  };
  setTimeout(() => {
    run();
    setInterval(run, everyMs).unref();
  }, firstMs).unref();
}
