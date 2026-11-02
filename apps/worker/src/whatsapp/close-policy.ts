// What the WhatsApp connector does when its socket closes, as a pure decision so it can be tested. Only a definite logout
// (401) wipes the session: a 403 or a multi-device mismatch can be a passing restriction, and wiping loses the whole link
// and app state. A replaced connection (440) means a second socket took the link: the worker that still owns the account
// reconnects after a growing pause (and says so if it keeps happening), the one that does not owns it stops quietly. A
// corrupt session (500) retries on a capped backoff and, after a few failures, asks the user to relink. Counters are
// per connector and reset when a connection opens.

/** Baileys' DisconnectReason codes, copied so this file needs no import. */
export const CODE = { loggedOut: 401, forbidden: 403, timedOut: 408, connectionReplaced: 440, multideviceMismatch: 411, badSession: 500, restartRequired: 515 } as const;

export interface CloseCounts {
  forbidden: number;
  replaced: number;
  bad: number;
}

export const noCloses = (): CloseCounts => ({ forbidden: 0, replaced: 0, bad: 0 });

export type CloseAction =
  | { kind: "restart" }
  /** The session is dead: wipe it and show `detail`. */
  | { kind: "logged-out"; detail: string }
  | { kind: "link-expired"; detail: string }
  /** Another worker owns this account now: stop without touching the account's status. */
  | { kind: "yield" }
  /** Reconnect no sooner than `minDelayMs`; `attention` (when set) is shown in Settings as the reason. */
  | { kind: "reconnect"; minDelayMs: number; attention: string | null };

export const PAUSE_STEP_MS = 60_000;
export const PAUSE_CAP_MS = 30 * 60_000;
/** Failures of one kind before the user is told. */
export const ATTENTION_AFTER = { forbidden: 2, replaced: 4, bad: 3 } as const;

const pause = (count: number) => Math.min(PAUSE_CAP_MS, PAUSE_STEP_MS * 2 ** Math.max(0, count - 1));

export function decideClose(input: { status: number | undefined; wasLinked: boolean; ownsAccount: boolean; counts: CloseCounts }): { action: CloseAction; counts: CloseCounts } {
  const { status, wasLinked, ownsAccount } = input;
  const counts = { ...input.counts };
  const reconnect = (minDelayMs: number, attention: string | null = null) => ({ action: { kind: "reconnect", minDelayMs, attention } as const, counts });

  if (status === CODE.restartRequired) return { action: { kind: "restart" }, counts };
  if (status === CODE.loggedOut) return { action: { kind: "logged-out", detail: "WhatsApp unlinked this device. Scan the QR code again." }, counts };
  if (!wasLinked && status === CODE.timedOut) return { action: { kind: "link-expired", detail: "The code expired before it was scanned. Scan the QR code again." }, counts };

  if (status === CODE.connectionReplaced) {
    if (!ownsAccount) return { action: { kind: "yield" }, counts };
    counts.replaced++;
    return reconnect(pause(counts.replaced), counts.replaced >= ATTENTION_AFTER.replaced ? "Another copy of the worker keeps taking over this WhatsApp link. Stop the other one." : null);
  }
  if (status === CODE.forbidden || status === CODE.multideviceMismatch) {
    counts.forbidden++;
    return reconnect(pause(counts.forbidden), counts.forbidden >= ATTENTION_AFTER.forbidden ? "WhatsApp refused this device. Retrying slowly. If it keeps happening, scan the QR code again." : null);
  }
  if (status === CODE.badSession) {
    counts.bad++;
    return reconnect(pause(counts.bad), counts.bad >= ATTENTION_AFTER.bad ? "WhatsApp session is damaged. Scan the QR code again." : null);
  }
  return reconnect(0);
}
