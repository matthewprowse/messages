// What the LinkedIn connector does when LinkedIn pushes back. A 429 (too many requests) or LinkedIn's own
// 999 (request refused) stops every request for half an hour, doubling each time up to six hours; three
// 999s in a row stop the account until you reconnect. A session LinkedIn no longer accepts, or a 403,
// stops it at once with the reason. Anything else is a dropped connection, retried with the usual backoff.
// Pure, so it can be unit tested.

import { HelperError } from "./helper";

export const LIMITED_FIRST_MS = 30 * 60_000;
export const LIMITED_MAX_MS = 6 * 60 * 60_000;
export const MAX_REFUSALS = 3;

export const SIGNED_OUT = "LinkedIn signed Konva out. Sign in to LinkedIn again to reconnect.";
export const RESTRICTED = "LinkedIn refused access to this account. Open LinkedIn in your browser and check for a notice, then reconnect here.";
export const REFUSED = "LinkedIn kept refusing requests, so syncing stopped to protect your account. Wait a day, then reconnect in Settings.";
// Shown to people, so it never names a command. The operator's log line for it is in the connector.
export const NOT_BUILT = "LinkedIn is not available on this Konva server right now. Try again later.";
export const NO_COOKIES = "Sign in to LinkedIn to connect.";
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
  return err instanceof HelperError && ["bad_credentials", "rate_limited", "refused", "forbidden", "bad_request", "not_found", "ambiguous"].includes(err.kind);
}

export const SEND_TURNED_AWAY = "LinkedIn did not take the message, so it was not sent. Try again later.";
export const SEND_MAYBE_SENT = "The message may not have been sent. Check LinkedIn before sending again.";
export const SEND_PARTIAL = "Only some of the files were sent to LinkedIn. Check LinkedIn before sending the rest.";
export const FILES_NOT_TAKEN = "LinkedIn could not take the files, so nothing more was sent. Try again.";

/** What a failed reply says on its outbox row. */
export function sendFailure(err: unknown): string {
  if (err instanceof HelperError && err.kind === "partial") return SEND_PARTIAL;
  return surelyNotSent(err) ? SEND_TURNED_AWAY : SEND_MAYBE_SENT;
}

// Starting a conversation. These are saved on the outbox row, which the person sees under the message.

export const START_NO_PERSON = "Enter one LinkedIn profile link, or choose someone you already message on LinkedIn.";
export const START_NOT_FOUND = "Konva could not find that person on LinkedIn. Paste the link to their profile, or choose them from your contacts.";
export const START_AMBIGUOUS = "More than one person on LinkedIn has that name. Paste the link to their profile instead.";
export const START_REFUSED = "LinkedIn did not allow this message, so it was not sent. You may need to be connected to this person first.";
export const START_TURNED_AWAY = "LinkedIn did not take the message, so it was not sent. Try again later.";
export const START_MAYBE_SENT = "The message may not have been sent. Check LinkedIn before sending again.";
export const START_PARTIAL = "The conversation was started, but only some of the files were sent. Check LinkedIn before sending the rest.";

/** The one person a new conversation is to: the first and only address, or null when there is not exactly one. */
export function recipientOf(toAddresses: string[]): string | null {
  const only = toAddresses.length === 1 ? toAddresses[0]?.trim() : "";
  return only ? only : null;
}

/** What a failed start says. LinkedIn declining a message to someone you are not connected to is a 403 or a 4xx. */
export function startFailure(err: unknown, withFiles = false): string {
  if (!(err instanceof HelperError)) return START_MAYBE_SENT;
  switch (err.kind) {
    case "partial":
      return START_PARTIAL;
    case "not_found":
      return START_NOT_FOUND;
    case "ambiguous":
      return START_AMBIGUOUS;
    case "bad_request":
      // Without a status the helper turned the command away itself: the person, or one of the files.
      return err.status ? START_REFUSED : withFiles ? FILES_NOT_TAKEN : START_NO_PERSON;
    case "forbidden":
      return START_REFUSED;
  }
  return surelyNotSent(err) ? START_TURNED_AWAY : START_MAYBE_SENT;
}

/** Whether the failure says something about the whole session (signed out, slowed down), not about this message. */
export function endsSession(err: unknown): boolean {
  return err instanceof HelperError && surelyNotSent(err) && !["bad_request", "not_found", "ambiguous"].includes(err.kind);
}

// Signing in with a password. These are shown on the sign-in form, and none of them asks for a command or a
// setting: what a person can do is try again, or approve the sign-in in the LinkedIn app.

export const SIGN_IN_REJECTED = "LinkedIn did not accept that email and password. Check them and try again.";
export const SIGN_IN_BLOCKED = "LinkedIn blocked this sign-in. Open the LinkedIn app and approve the sign-in if it asks, then try again.";
export const SIGN_IN_CHALLENGE = "LinkedIn asked for a check Konva cannot complete. Open the LinkedIn app and approve the sign-in if it asks, then try again.";
export const SIGN_IN_RATE_LIMITED = "LinkedIn asked Konva to slow down. Wait a while, then try again.";
export const SIGN_IN_UNAVAILABLE = "LinkedIn could not be reached. Try again in a few minutes.";
export const SIGN_IN_FAILED = "Signing in to LinkedIn did not work. Try again.";
export const SIGN_IN_EXPIRED = "That sign-in took too long. Sign in to LinkedIn again.";
export const APP_EXPIRED = "The sign-in was not approved in the LinkedIn app in time. Try again.";
export const CODE_TIMED_OUT = "The code was not entered in time. Try again.";

/** What the sign-in form says when the sign-in ended for good. err is what the helper reported (or a timeout). */
export function signInFailure(err: unknown): string {
  if (!(err instanceof HelperError)) return SIGN_IN_FAILED;
  switch (err.kind) {
    case "rejected":
      return err.stage === "app_approval_expired" ? APP_EXPIRED : SIGN_IN_REJECTED;
    case "blocked":
    case "forbidden":
    case "refused":
      return SIGN_IN_BLOCKED;
    case "challenge":
      return SIGN_IN_CHALLENGE;
    case "rate_limited":
      return SIGN_IN_RATE_LIMITED;
    case "unavailable":
    case "timeout":
      return SIGN_IN_UNAVAILABLE;
    default:
      return SIGN_IN_FAILED;
  }
}

/** What to say while the sign-in waits at a check. */
export function checkpointDetail(step: { kind: "code" | "app"; method: "email" | "sms" | "totp" | null }, rejected = false): string {
  if (step.kind === "app") return "Approve the sign-in in the LinkedIn app on your phone.";
  const where = step.method === "sms" ? "LinkedIn texted you" : step.method === "totp" ? "your authenticator app shows" : "LinkedIn emailed you";
  return `${rejected ? "That code did not work. " : ""}Enter the 6-digit code ${where}.`;
}
