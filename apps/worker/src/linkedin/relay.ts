// How a password sign-in talks to the web page while LinkedIn asks for something. There is no table for it, so
// it lives in account_credentials.refreshed, sealed like the sign-in itself: the worker writes the step it is
// waiting at, the app (apps/web/app/api/connect/linkedin/code) shows it and writes back the code typed or a
// request for another way, and the worker takes it within a couple of seconds. That column, unlike
// ciphertext, can change without restarting the connector. The web side holds the same shapes.

/** What the sign-in is waiting for. attempts counts the steps shown, so the page knows a new one has come. */
export interface SignInStep {
  kind: "code" | "app";
  method: "email" | "sms" | "totp" | null;
  /** For an approval in the app: LinkedIn can send a code instead. */
  canTryAnotherWay: boolean;
  attempts: number;
  /** The last code was wrong. */
  rejected: boolean;
}

export interface Relay {
  step: SignInStep | null;
  /** From the app: the six digits typed. */
  code?: string;
  /** From the app: the person chose Try Another Way. */
  tryAnotherWay?: boolean;
}

/** What the person did: typed a code, or asked for another way. */
export type Reply = { code: string } | { anotherWay: true };

const CODE = /^[0-9]{6}$/;

/** A relay as read back, whatever it holds; anything unexpected is dropped. */
export function parseRelay(value: unknown): Relay {
  const v = (value && typeof value === "object" ? value : {}) as Partial<Relay>;
  const s = v.step as Partial<SignInStep> | null | undefined;
  const step: SignInStep | null =
    s && (s.kind === "code" || s.kind === "app")
      ? {
          kind: s.kind,
          method: s.method === "email" || s.method === "sms" || s.method === "totp" ? s.method : null,
          canTryAnotherWay: s.canTryAnotherWay === true,
          attempts: typeof s.attempts === "number" ? s.attempts : 0,
          rejected: s.rejected === true,
        }
      : null;
  return {
    step,
    ...(typeof v.code === "string" && CODE.test(v.code) ? { code: v.code } : {}),
    ...(v.tryAnotherWay === true ? { tryAnotherWay: true } : {}),
  };
}

/**
 * Waits for the person to answer the step: a code (want "code") or Try Another Way (want "anotherWay"). Null
 * when the time is up or `stopped` says so. Pure but for what it is given, so it can be tested.
 */
export async function waitForReply(
  read: () => Promise<Relay>,
  wait: (ms: number) => Promise<void>,
  opts: { want: "code" | "anotherWay"; timeoutMs: number; pollMs: number; stopped: () => boolean; now?: () => number },
): Promise<Reply | null> {
  const now = opts.now ?? Date.now;
  const deadline = now() + opts.timeoutMs;
  while (!opts.stopped()) {
    const relay = await read().catch((): Relay => ({ step: null }));
    if (opts.want === "code" && relay.code) return { code: relay.code };
    if (opts.want === "anotherWay" && relay.tryAnotherWay) return { anotherWay: true };
    if (now() >= deadline) return null;
    await wait(opts.pollMs);
  }
  return null;
}
