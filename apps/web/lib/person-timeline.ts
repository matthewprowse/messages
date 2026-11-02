// The combined timeline of one person across channels: every loaded message of their conversations in date order, each tagged
// with its conversation, with linked (same matter) conversations drawn together under a heading. Also which conversation a
// reply goes to. Pure: components/person renders it.

import type { Channel, Message, Thread } from "./types";

/** At most this many of a person's conversations are loaded into their timeline, newest first. */
export const PERSON_THREADS = 12;

/** A message and the conversation it belongs to, which gives its channel badge. */
export interface TimelineEntry { message: Message; thread: Thread }

export type TimelineBlock =
  | { kind: "messages"; key: string; entries: TimelineEntry[] }
  | { kind: "matter"; key: string; title: string; threadIds: string[]; entries: TimelineEntry[] };

/** The channel names shown on badges and in the reply channel picker. */
export const CHANNEL_LABEL: Partial<Record<Channel, string>> = { email: "Email", whatsapp: "WhatsApp", linkedin: "LinkedIn", instagram: "Instagram" };

/** What to call a conversation in a badge or a sentence: an email by its subject, a chat by its channel. */
export function threadLabel(t: Thread): string {
  return t.channel === "email" ? t.subject?.trim() || "No Subject" : `${CHANNEL_LABEL[t.channel] ?? "Chat"} Chat`;
}

/** A person's one-to-one conversations (not deleted), newest first, capped at PERSON_THREADS. */
export function personThreads(threads: Thread[], personId: string, cap = PERSON_THREADS): Thread[] {
  return threads
    .filter((t) => !t.isGroup && t.status !== "trash" && t.participantIds.includes(personId))
    .sort((a, b) => b.lastMessageAt.localeCompare(a.lastMessageAt))
    .slice(0, cap);
}

/** The heading of a matter: the email's subject when one of its conversations is an email, else a plain name. */
export function matterTitle(threads: Thread[]): string {
  const subject = threads.find((t) => t.channel === "email" && t.subject?.trim())?.subject?.trim();
  return subject ?? "Linked Conversations";
}

/**
 * Messages in date order as blocks. A matter is a group of linked conversations: its messages sit together in one block,
 * placed where its first message falls, instead of being spread among everything else. Messages of unlinked
 * conversations run in plain blocks around it. Pending (unsent) messages sort by their time like the rest.
 */
export function buildTimeline(threads: Thread[], messagesOf: (threadId: string) => Message[], matters: string[][]): TimelineBlock[] {
  const matterOf = new Map<string, number>();
  matters.forEach((g, i) => g.forEach((id) => matterOf.set(id, i)));
  const entries: TimelineEntry[] = threads.flatMap((thread) => messagesOf(thread.id).map((message) => ({ message, thread })));
  entries.sort((a, b) => a.message.sentAt.localeCompare(b.message.sentAt) || a.message.id.localeCompare(b.message.id));
  const byThread = new Map(threads.map((t) => [t.id, t]));
  const out: TimelineBlock[] = [];
  const done = new Set<number>();
  for (const e of entries) {
    const m = matterOf.get(e.thread.id);
    if (m === undefined) {
      const last = out[out.length - 1];
      if (last?.kind === "messages") last.entries.push(e);
      else out.push({ kind: "messages", key: e.message.id, entries: [e] });
      continue;
    }
    if (done.has(m)) continue;
    done.add(m);
    const ids = new Set(matters[m]);
    const mine = entries.filter((x) => ids.has(x.thread.id));
    out.push({ kind: "matter", key: `matter:${[...ids].sort().join("+")}`, title: matterTitle(matters[m].flatMap((id) => byThread.get(id) ?? [])), threadIds: matters[m], entries: mine });
  }
  return out;
}

/** Where a reply can go: the newest conversation of each channel, with `preferred` standing in for its own channel. */
export function replyOptions(threads: Thread[], preferred?: Thread): Thread[] {
  const byChannel = new Map<Channel, Thread>();
  for (const t of [...threads].sort((a, b) => b.lastMessageAt.localeCompare(a.lastMessageAt))) if (!byChannel.has(t.channel)) byChannel.set(t.channel, t);
  if (preferred) byChannel.set(preferred.channel, preferred);
  return [...byChannel.values()].sort((a, b) => (CHANNEL_ORDER.indexOf(a.channel) - CHANNEL_ORDER.indexOf(b.channel)));
}
const CHANNEL_ORDER: Channel[] = ["email", "whatsapp", "linkedin", "instagram"];

/**
 * The conversation their last message came in on: the newest message that is not yours among the loaded ones, else (before
 * anything has loaded) the conversation with the newest activity. Undefined for a person with no conversations.
 */
export function lastIncomingThread(threads: Thread[], messagesOf: (threadId: string) => Message[]): Thread | undefined {
  let best: { thread: Thread; at: string } | undefined;
  for (const thread of threads) {
    for (const m of messagesOf(thread.id)) {
      if (m.from === "me" || m.sendState) continue;
      if (!best || m.sentAt > best.at) best = { thread, at: m.sentAt };
    }
  }
  return best?.thread ?? [...threads].sort((a, b) => b.lastMessageAt.localeCompare(a.lastMessageAt))[0];
}
