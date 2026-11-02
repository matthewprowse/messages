// What a reply that is not in the mailbox yet says about itself under its bubble. The outbox row moves queued, sending,
// sent (the provider took it, its copy has not been imported yet) or failed; the bubble used to say "Sending" for all
// but failed, so a reply the provider had already accepted still looked unsent.

import type { Message } from "./types";

/** The bubble state for an outbox status. */
export function sendStateOf(status: "queued" | "sending" | "sent" | "failed"): NonNullable<Message["sendState"]> {
  return status;
}

/** Why a queued WhatsApp message is still waiting: a send limit the account has reached. It goes by itself once the limit lifts. */
export function waitLabel(reason: NonNullable<Message["waitReason"]>): string {
  return reason === "daily_limit" ? "Waiting: Daily WhatsApp Limit" : "Waiting: New Chat Limit";
}

/** The line under the bubble, Title Case free text for each state. */
export function sendStateLabel(state: NonNullable<Message["sendState"]>): string {
  switch (state) {
    case "queued": return "Waiting to Send";
    case "sending": return "Sending";
    case "sent": return "Sent";
    case "failed": return "Not Sent";
  }
}
