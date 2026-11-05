// Made-up data for the screen tests, in the spirit of e2e/support/fake-data.ts: the same invented people at the
// reserved example domains, conversations about ordinary client work, nothing real. Builders take overrides so a test
// states only what it cares about.

import type { Account, Contact, Message, Task, Thread } from "@/lib/types";
import type { Label } from "@/lib/labels";

/** A time n minutes before now, as ISO text: fixtures are relative to the clock so "Today" and "2h" read the same on every run. */
export const minutesAgo = (n: number) => new Date(Date.now() - n * 60_000).toISOString();

/** A contact; id, name and email default from a short key ("ava"). */
export function contact(key: string, name: string, address: string, extra: Partial<Contact> = {}): Contact {
  const initials = name.split(" ").map((w) => w[0]).join("").slice(0, 2).toUpperCase();
  return { id: `contact-${key}`, name, initials, hue: 200, emails: [address], phones: [], isCompany: false, ...extra };
}

export const AVA = contact("ava", "Ava Thompson", "ava.thompson@example.com", { company: "Thompson Interiors" });
export const BEN = contact("ben", "Ben Carter", "ben.carter@example.org");
export const CHLOE = contact("chloe", "Chloe Naidoo", "chloe.naidoo@example.net", { phones: ["+27820000001"] });
export const DANIEL = contact("daniel", "Daniel Mokoena", "daniel.mokoena@example.com");
export const PEOPLE: Contact[] = [AVA, BEN, CHLOE, DANIEL];

/** The fake mailbox, at an example.com address with nothing behind it. */
export const ACCOUNT: Account = {
  id: "account-work", provider: "gmail", label: "Gmail", detail: "screen-test-inbox@example.com", status: "connected",
  sendAddresses: ["screen-test-inbox@example.com"],
};
export const WHATSAPP_ACCOUNT: Account = {
  id: "account-whatsapp", provider: "whatsapp", label: "WhatsApp", detail: "+27 82 000 0000", status: "connected", sendAddresses: [],
};

/** A read, ordinary email conversation in the inbox; override what the test is about. */
export function thread(id: string, extra: Partial<Thread> = {}): Thread {
  return {
    id, accountId: ACCOUNT.id, channel: "email", provider: "gmail", subject: "Kitchen Renovation Quote", participantIds: [AVA.id],
    lastMessageAt: minutesAgo(30), preview: "Please include the oak worktops as a separate line.", unread: false, unreadCount: 0,
    pinned: false, status: "inbox", priority: "normal", category: "work", summary: "", needsReply: false, lastFromMe: false,
    junk: false, subscription: false, ...extra,
  };
}

export const KITCHEN = thread("thread-kitchen", { unread: true, unreadCount: 1, priority: "urgent", needsReply: true, summary: "Wants the oak worktops priced separately." });
export const LEASE = thread("thread-lease", { subject: "Lease Renewal for Unit 4B", participantIds: [BEN.id], preview: "The landlord needs an answer by Friday.", lastMessageAt: minutesAgo(50), needsReply: true });
export const GARDEN = thread("thread-garden", { subject: "Garden Service Schedule", participantIds: [CHLOE.id], preview: "Wednesdays suit us well.", lastMessageAt: minutesAgo(600), lastFromMe: true, priority: "low", category: "fyi" });
export const CHAT = thread("thread-chat", { channel: "whatsapp", provider: "whatsapp", accountId: WHATSAPP_ACCOUNT.id, subject: undefined, participantIds: [CHLOE.id], preview: "See you at nine.", lastMessageAt: minutesAgo(90) });
export const THREADS: Thread[] = [KITCHEN, LEASE, GARDEN, CHAT];

/** A message in a conversation; from is a contact id or "me". */
export function message(id: string, threadId: string, from: string, body: string, minutes: number, extra: Partial<Message> = {}): Message {
  return { id, threadId, from, body, sentAt: minutesAgo(minutes), ...extra };
}

export const KITCHEN_MESSAGES: Message[] = [
  message("m-1", KITCHEN.id, AVA.id, "Hi, could you send a quote for the kitchen renovation we discussed on site?", 2880, { address: AVA.emails[0] }),
  message("m-2", KITCHEN.id, "me", "Of course. I will have the full quote with you by Thursday.", 2790, { address: ACCOUNT.detail }),
  message("m-3", KITCHEN.id, AVA.id, "Thanks. Please include the cost of the oak worktops as a separate line.", 30, { address: AVA.emails[0] }),
];

export const LABELS: Label[] = [
  { id: "label-clients", name: "Clients", color: "blue" },
  { id: "label-invoices", name: "Invoices", color: "green" },
];

/** A task due today unless overridden. */
export function task(id: string, title: string, extra: Partial<Task> = {}): Task {
  return { id, accountId: "account-tasks", title, dueAt: new Date().toISOString(), dueAllDay: true, completed: false, ...extra };
}
