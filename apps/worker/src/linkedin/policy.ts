import { HelperError } from "./helper";

// What the LinkedIn connector does when LinkedIn pushes back. A 429 (too many requests) or LinkedIn's own
// 999 (request refused) stops every request for half an hour, doubling each time up to six hours; three
// 999s in a row stop the account until you reconnect. A session LinkedIn no longer accepts, or a 403,
// stops it at once with the reason. Anything else is a dropped connection, retried with the usual backoff.
// Pure, so it can be unit tested.

export const LIMITED_FIRST_MS = 30 * 60_000;
export const LIMITED_MAX_MS = 6 * 60 * 60_000;
export const MAX_REFUSALS = 3;

export const SIGNED_OUT = "LinkedIn signed Konva out. Copy your LinkedIn cookies again in Settings to reconnect.";
export const RESTRICTED = "LinkedIn refused access to this account. Open LinkedIn in your browser and check for a notice, then reconnect here.";
export const REFUSED = "LinkedIn kept refusing requests, so syncing stopped to protect your account. Wait a day, then reconnect in Settings.";
export const NOT_BUILT = "The LinkedIn helper is not built on this computer. Run pnpm linkedin:build, then reconnect.";
export const NO_COOKIES = "Copy your LinkedIn cookies in Settings to connect.";
export const RECONNECTING = "Connection to LinkedIn lost. Reconnecting.";

export function slowDown(waitMs: number): string {
  return `LinkedIn asked Konva to slow down. Trying again in about ${Math.max(1, Math.round(waitMs / 60_000))} minutes.`;
}

/** The back-off after 429s and 999s. A session that connects resets it. */
export class PushBack {
  times = 0;
  refusals = 0;

  hit(status: "rate_limited" | "refused", random = Math.random): number {
    this.times++;
    this.refusals = status === "refused" ? this.refusals + 1 : 0;
    return Math.round(Math.min(LIMITED_MAX_MS, LIMITED_FIRST_MS * 2 ** (this.times - 1)) * (1 + random() * 0.2));
  }

  giveUp(): boolean {
    return this.refusals >= MAX_REFUSALS;
  }

  ok() {
    this.times = 0;
    this.refusals = 0;
  }
}

/** What to do after a session ends: stop with a reason for Settings, or wait (null: the usual backoff) and try again. */
export type Outcome = { stop: true; detail: string } | { stop: false; detail: string; waitMs: number | null };

export function outcomeOf(err: unknown, pushback: PushBack, random = Math.random): Outcome {
  const kind = err instanceof HelperError ? err.kind : "failed";
  if (kind === "bad_credentials") return { stop: true, detail: SIGNED_OUT };
  if (kind === "forbidden") return { stop: true, detail: RESTRICTED };
  if (kind === "rate_limited" || kind === "refused") {
    const waitMs = pushback.hit(kind, random);
    return pushback.giveUp() ? { stop: true, detail: REFUSED } : { stop: false, detail: slowDown(waitMs), waitMs };
  }
  return { stop: false, detail: RECONNECTING, waitMs: null };
}

/** Whether a failed send certainly did not go out: LinkedIn turned the request away. */
export function surelyNotSent(err: unknown): boolean {
  return err instanceof HelperError && ["bad_credentials", "rate_limited", "refused", "forbidden", "bad_request"].includes(err.kind);
}
