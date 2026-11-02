// Wording for a WhatsApp reply that did not fully go out, and the delivery tick a Baileys status stands for. Pure.

/** Why an outbox row failed after sending began: some parts went, or none is known to have. */
export function sendFailureReason(sentParts: number, parts: number): string {
  return sentParts > 0
    ? `Only ${sentParts} of ${parts} parts were sent. Check WhatsApp before sending the rest.`
    : "The message may not have been sent. Check WhatsApp before sending again.";
}

/** Baileys' statuses: 2 reached WhatsApp's server, 3 delivered, 4 read, 5 played (a voice note heard). Null below 2. */
export function receiptOf(status: number): "read" | "delivered" | "sent" | null {
  return status >= 4 ? "read" : status === 3 ? "delivered" : status === 2 ? "sent" : null;
}
