// Pure rules for which address an email is sent from and who it can go to. No I/O, so it can be unit tested.

export const FROM_NOT_ALLOWED = "You can't send from that address on this account.";
export const BAD_RECIPIENTS = "Check the recipients. One of them is not a valid email address.";

const MAX_RECIPIENTS = 100;

/** One address as compared and sent: line breaks removed first, so it can never start a header of its own. */
function norm(address: string): string {
  return address.replace(/[\r\n]+/g, "").trim().toLowerCase();
}

/** Addresses as they are compared: trimmed, lowercase, empty ones dropped. */
export function normAddresses(list: readonly (string | null | undefined)[]): string[] {
  return list.map((a) => norm(a ?? "")).filter(Boolean);
}

/**
 * The From address for one email. A chosen address is used only when the account can send from it.
 * With none chosen, a reply goes from whichever of your addresses the email it answers was sent to,
 * else from the account's main address.
 */
export function chooseFrom(opts: {
  requested: string | null;
  accountAddress: string;
  sendAddresses: string[];
  /** To and Cc of the latest inbound message, for a reply. Empty for a new email. */
  inboundTo: string[];
}): { address: string } | { error: string } {
  const main = norm(opts.accountAddress);
  const allowed = new Set([main, ...opts.sendAddresses.map(norm)].filter(Boolean));
  const requested = opts.requested ? norm(opts.requested) : "";
  if (requested) return allowed.has(requested) ? { address: requested } : { error: FROM_NOT_ALLOWED };
  const answered = opts.inboundTo.map(norm).find((a) => allowed.has(a));
  return { address: answered ?? main };
}

/**
 * Addresses a reply's default From is picked from, newest first: those the latest inbound email was sent
 * to, or, in a conversation you started with no answer yet, the address your latest email went from.
 */
export function fromCandidates(messages: { direction: string; to_addresses: string[]; sender_address: string | null }[]): string[] {
  const inbound = messages.find((m) => m.direction === "inbound");
  if (inbound) return inbound.to_addresses;
  const mine = messages.find((m) => m.direction === "outbound")?.sender_address;
  return mine ? [mine] : [];
}

/**
 * Who a reply to one chosen email goes to, and which addresses its default From is picked from. An
 * email from someone else is answered to its sender. Your own email is answered to the people it went
 * to, as Mail and Gmail do, from the address it went out from. One that only went between your own
 * addresses is answered to the address it came from.
 */
export function replyToChosen(
  chosen: { direction: string; sender_address: string | null; to_addresses: string[] },
  selfAddresses: Set<string>,
): { to: string[]; inboundTo: string[] } {
  const sender = chosen.sender_address ? norm(chosen.sender_address) : null;
  if (chosen.direction === "inbound" && sender && !selfAddresses.has(sender)) return { to: [sender], inboundTo: chosen.to_addresses };
  const to = [...new Set(chosen.to_addresses.map(norm))].filter((a) => !selfAddresses.has(a));
  return { to: to.length > 0 ? to : sender ? [sender] : [], inboundTo: sender ? [sender] : [] };
}

/**
 * Who a reply goes to when no one else has written in the conversation: its other people. When everyone
 * in it is you (mail between your own addresses), the address the latest email came from.
 */
export function replyToParticipants(emails: string[], latestSender: string | null, selfAddresses: Set<string>): string[] {
  const to = [...new Set(emails.map(norm))].filter((a) => !selfAddresses.has(a));
  if (to.length > 0) return to;
  return latestSender ? [norm(latestSender)] : [];
}

/** A plausible single address: one @, a dotted domain, no spaces, brackets or separators. */
export function isEmailAddress(value: string): boolean {
  if (value.length > 254) return false;
  return /^[^\s@<>()\[\],;:"\\]+@[^\s@<>()\[\],;:"\\]+\.[^\s@<>()\[\],;:"\\.]+$/.test(value) && !value.includes("..");
}

/** Lowercased, deduped recipients, or null when the list is empty, too long or has a bad address. */
export function cleanRecipients(list: string[]): string[] | null {
  const out = [...new Set(list.map(norm).filter(Boolean))];
  if (out.length === 0 || out.length > MAX_RECIPIENTS) return null;
  return out.every(isEmailAddress) ? out : null;
}

export interface OutgoingRecipients {
  /** Empty only for a reply that works out its own recipients. */
  to: string[];
  cc: string[];
  bcc: string[];
  /** A reply whose To or Cc was set in the app (Reply All, or edited), so it goes to exactly those. */
  explicit: boolean;
}

/** An optional list of addresses: empty is fine, a bad or unreadable one is not (null). */
function cleanOptional(list: readonly string[] | null | undefined): string[] | null {
  const items = list ?? [];
  if (items.some((a) => !norm(a))) return null; // an address that could not be opened must not be skipped quietly
  const out = [...new Set(items.map(norm))];
  if (out.length > MAX_RECIPIENTS) return null;
  return out.every(isEmailAddress) ? out : null;
}

/**
 * Who an outbox row goes to. A new email needs a To. A reply with To or Cc set goes to exactly those;
 * with neither set, its To is left empty for the worker to work out from the conversation. Someone on
 * more than one line is kept on the first (To, then Cc, then Bcc), so nobody gets the same email twice.
 */
export function outgoingRecipients(
  row: { to_addresses: string[]; cc_addresses: string[]; bcc_addresses: string[] },
  isReply: boolean,
): OutgoingRecipients | { error: string } {
  const to = cleanOptional(row.to_addresses);
  const cc = cleanOptional(row.cc_addresses);
  const bcc = cleanOptional(row.bcc_addresses);
  if (!to || !cc || !bcc) return { error: BAD_RECIPIENTS };
  const explicit = isReply && (to.length > 0 || cc.length > 0);
  if (!isReply && to.length === 0) return { error: BAD_RECIPIENTS };
  const seen = new Set(to);
  const ccOnly = cc.filter((a) => !seen.has(a));
  ccOnly.forEach((a) => seen.add(a));
  const bccOnly = bcc.filter((a) => !seen.has(a));
  return { to, cc: ccOnly, bcc: bccOnly, explicit };
}
