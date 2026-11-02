// What the AI says about why it labelled a conversation, and what "Not Right?" can do about it. Pure: the reason code is a
// closed list written by the AI worker (ai/triage_extras.py), the words next to it are sealed and opened by the caller.

import type { Thread } from "./types";

/** Likely fraud kinds the AI worker can flag, with the warning each shows. The app only warns, it never acts. */
export const SUSPICIOUS_COPY: Record<string, { title: string; text: string }> = {
  payment_change: { title: "Check Before You Pay", text: "This asks for money to go to new or changed bank details. Call the sender on a number you already have before you pay anything." },
  phishing: { title: "Possible Phishing", text: "This may be trying to get a password, code or card number. Do not open links or attachments unless you are sure." },
  impersonation: { title: "May Not Be Who It Says", text: "The sender may be pretending to be someone you know or a company you deal with. Check with them another way." },
};

/** The fixed words for a reason code, used when the AI gave none of its own. */
const PHRASES: Record<string, string> = {
  deadline: "Deadline soon", asked_you: "You were asked something", waiting_on_you: "Someone is waiting on you", client_important: "Looks important to your work",
  personal: "A person writing to you", bulk_mail: "Bulk mail", newsletter: "Newsletter", promotion: "Marketing", automated: "Automated message",
  receipt_or_bill: "Receipt or bill", security: "Security notice", other: "Sorted by the AI", rule_always: "Marked always important by you",
  rule_never: "Marked never important by you", vip: "Starred contact", unsubscribed: "You unsubscribed from this sender", marked_junk: "You marked this conversation Junk",
  marked_not_junk: "You marked this conversation Not Junk", marked_important: "You marked this conversation Important", marked_not_important: "You marked this conversation Not Important",
  sender_settled: "Bulk sender you never answer", no_reply_needed: "You said no reply is needed", copied: "Same email as in another account",
};

/** The sentence to show: the AI's own words, else the code's fixed words, else nothing (the AI has not explained this one). */
export function whyText(code: string | null | undefined, words: string | null | undefined): string | null {
  const own = (words ?? "").replace(/\s+/g, " ").trim();
  if (own) return own.slice(0, 80);
  return code ? PHRASES[code] ?? null : null;
}

export type NotRight = { value: "not_important" | "no_reply_needed" | "not_junk"; label: string };

/** The ways to say a label is wrong, by what the conversation is marked now. Each feeds the corrections the AI already learns from. */
export function notRightOptions(t: Pick<Thread, "priority" | "needsReply" | "lastFromMe" | "junk" | "status">): NotRight[] {
  if (t.junk) return [{ value: "not_junk", label: "Not Junk" }];
  const out: NotRight[] = [];
  if (t.priority === "urgent" || t.priority === "important") out.push({ value: "not_important", label: "Not Important" });
  if (t.needsReply && !t.lastFromMe) out.push({ value: "no_reply_needed", label: "No Reply Needed" });
  return out;
}
