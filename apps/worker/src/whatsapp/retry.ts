// A short, bounded retry for storing a WhatsApp message. Baileys never redelivers a message it handed over, so a
// transient database error would otherwise lose it. In memory and capped: nothing is queued beyond the attempts here.

/** Tries per message or history chunk, and the first wait in ms (doubling), about 3.5 s in all. */
export const STORE_ATTEMPTS = 4;
export const STORE_RETRY_MS = 500;

/**
 * Runs `step`, again after a doubling wait if it throws, up to `attempts` tries. Throws the last error when all fail.
 * `wait` is injectable so tests do not sleep.
 */
export async function retryStore<T>(step: () => Promise<T>, wait: (ms: number) => Promise<void>, attempts = STORE_ATTEMPTS, baseMs = STORE_RETRY_MS): Promise<T> {
  for (let i = 0; ; i++) {
    try {
      return await step();
    } catch (err) {
      if (i + 1 >= attempts) throw err;
      await wait(baseMs * 2 ** i);
    }
  }
}
