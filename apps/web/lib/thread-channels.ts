// Which other conversations with the same person the header can jump to. Pure: ChannelTabs renders what it returns.

import type { Channel, Thread } from "./types";

/** Chat channels that get their own tab beside Email, in the order shown. */
export const CHAT_TABS: { channel: Channel; label: string }[] = [
  { channel: "whatsapp", label: "WhatsApp" },
  { channel: "instagram", label: "Instagram" },
  { channel: "linkedin", label: "LinkedIn" },
];

/** A person's one-to-one conversations (not deleted), newest first, split into email threads and the newest chat per channel. */
export function theirThreads(threads: Thread[], personId: string) {
  const newest = (a: Thread, b: Thread) => b.lastMessageAt.localeCompare(a.lastMessageAt);
  const theirs = threads.filter((t) => !t.isGroup && t.status !== "trash" && t.participantIds.includes(personId));
  const chats = new Map<Channel, Thread>();
  for (const { channel } of CHAT_TABS) {
    const top = theirs.filter((t) => t.channel === channel).sort(newest)[0];
    if (top) chats.set(channel, top);
  }
  return { emails: theirs.filter((t) => t.channel === "email").sort(newest), chats };
}
