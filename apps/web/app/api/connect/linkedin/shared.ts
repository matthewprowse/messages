// What the LinkedIn sign-in routes share with the page and the worker. While a password sign-in waits for a
// code or an approval in the LinkedIn app, the worker keeps the step it is at in account_credentials.refreshed,
// sealed, and the app writes the code typed (or a request for another way) beside it; apps/worker/src/linkedin/
// relay.ts holds the same shapes. That column, unlike ciphertext, changes without restarting the connector.

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
  code?: string;
  tryAnotherWay?: boolean;
}

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
  return { step };
}
