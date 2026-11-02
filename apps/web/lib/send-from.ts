// Who an email goes to and which address it goes out from, for the reply box and New Email.
// The sync worker applies the same rules when it sends, so what the app shows is what gets sent.

import type { Account, Channel, Contact, Message } from "./types";

/** Every address this account can send from, its own address first. Lowercase, no repeats. */
export function sendAddressesOf(account: Pick<Account, "detail" | "sendAddresses">): string[] {
  return [...new Set([account.detail, ...account.sendAddresses].map((a) => a.trim().toLowerCase()).filter(Boolean))];
}

/**
 * The default From for a reply: an address you can send from that the latest email was sent to. In a
 * conversation you started with no answer yet, the address your latest email went from. Else the default
 * you set for the account in Settings (preferred, when it is still one of its addresses), else its own address.
 */
export function defaultFrom(account: Pick<Account, "detail" | "sendAddresses">, msgs: Message[], preferred?: string): string {
  const own = sendAddressesOf(account);
  // Newest first, skipping replies still sending: the latest email from someone else, else your latest.
  let latest: Message | undefined;
  let mine: Message | undefined;
  for (let i = msgs.length - 1; i >= 0 && !latest; i--) {
    const m = msgs[i];
    if (m.sendState) continue;
    if (m.from !== "me") latest = m;
    else mine ??= m;
  }
  const candidates = latest ? latest.toAddresses ?? [] : [mine?.address ?? ""];
  const match = candidates.map((a) => a.toLowerCase()).find((a) => own.includes(a));
  const chosen = preferred?.trim().toLowerCase();
  return match ?? (chosen && own.includes(chosen) ? chosen : own[0]) ?? "";
}

export interface Recipient {
  contactId?: string;
  address: string;
}

/**
 * Who a reply goes to. Email answers the latest message from someone who is not you (Reply, not
 * Reply All), or everyone else in the conversation when only you have written. Chats go to the number.
 */
export function replyRecipients(
  channel: Channel,
  msgs: Message[],
  participants: Contact[],
  self: string[],
): Recipient[] {
  const mine = new Set(self.map((a) => a.toLowerCase()));
  for (let i = msgs.length - 1; i >= 0; i--) {
    const m = msgs[i];
    if (m.from !== "me" && m.address && !mine.has(m.address.toLowerCase())) return [{ contactId: m.from === "unknown" ? undefined : m.from, address: m.address }];
  }
  const out: Recipient[] = [];
  const seen = new Set<string>();
  for (const c of participants) {
    const values = channel === "email" ? c.emails.filter((e) => !mine.has(e.toLowerCase())) : c.phones.slice(0, 1);
    for (const address of values) {
      const key = address.toLowerCase();
      if (!seen.has(key)) { seen.add(key); out.push({ contactId: c.id, address }); }
    }
    if (channel !== "email" && out.length) break;
  }
  // Everyone in it is you (mail between your own addresses): the reply goes back to the latest sender.
  if (channel === "email" && out.length === 0) {
    const latest = msgs.at(-1);
    if (latest?.address) return [{ contactId: latest.from === "me" || latest.from === "unknown" ? undefined : latest.from, address: latest.address }];
  }
  return channel === "email" ? out : out.slice(0, 1);
}

export interface ReplyAll {
  to: string[];
  cc: string[];
}

/**
 * Who Reply All fills in. The message being answered is the one picked with Reply on a message, else the
 * latest from someone who is not you. Its sender goes in To; everyone else it was sent to goes in Cc
 * (the stored list holds To and Cc together), minus your own addresses. Answering your own email goes to
 * the people it was sent to. Lowercase, no repeats.
 */
export function replyAllRecipients(msgs: Message[], self: string[], target?: Message): ReplyAll {
  const mine = new Set(self.map((a) => a.trim().toLowerCase()));
  const clean = (list: (string | undefined)[]) => [...new Set(list.map((a) => (a ?? "").trim().toLowerCase()).filter((a) => a && !mine.has(a)))];
  let answered = target;
  if (!answered) {
    for (let i = msgs.length - 1; i >= 0 && !answered; i--) {
      const m = msgs[i];
      if (!m.sendState && m.from !== "me" && m.address && !mine.has(m.address.toLowerCase())) answered = m;
    }
  }
  if (!answered) return { to: [], cc: [] };
  const sender = answered.from !== "me" && answered.address ? clean([answered.address]) : [];
  if (sender.length) return { to: sender, cc: clean(answered.toAddresses ?? []).filter((a) => a !== sender[0]) };
  // Your own email (or one between your own addresses): everyone it went to.
  const to = clean(answered.toAddresses ?? []);
  if (to.length) return { to, cc: [] };
  return { to: clean([answered.address]), cc: [] };
}

// The same rule the sync worker checks before sending (isEmailAddress in apps/worker), so the app never
// queues an email the worker would refuse: one @, a dotted domain, no spaces, brackets or separators.
const EMAIL = /^[^\s@<>()\[\],;:"\\]+@[^\s@<>()\[\],;:"\\]+\.[^\s@<>()\[\],;:"\\.]+$/;
export const MAX_RECIPIENTS = 100;

export function isEmail(value: string) {
  const v = value.trim();
  return v.length <= 254 && EMAIL.test(v) && !v.includes("..");
}

/**
 * Splits a typed To line on commas, semicolons or spaces. A pasted "Jane Doe <jane@x.com>" counts as
 * the address in brackets. Returns the addresses and any that look wrong.
 */
export function parseAddresses(text: string): { valid: string[]; invalid: string[] } {
  const parts = text
    .replace(/(?:"[^"]*"|[^,;<>"])*<([^<>]*)>/g, " $1 ")
    .split(/[,;\s]+/)
    .map((p) => p.trim())
    .filter(Boolean);
  const valid = new Set<string>();
  const invalid: string[] = [];
  for (const p of parts) {
    if (isEmail(p)) valid.add(p.toLowerCase());
    else invalid.push(p);
  }
  return { valid: [...valid], invalid };
}
