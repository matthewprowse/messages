// What the Summary page gathers from your conversations. It is worked out in the browser from the labels
// the AI already puts on each conversation: whether it needs a reply, its priority, category and summary.

import { inFilter, isWaiting, priorityNow } from "./app-store/thread-filters";
import { isSnoozed } from "./snooze";
import type { ListFilter, Priority, Thread } from "./types";

/** Conversations waiting on a reply for longer than this move to Older. Mirrored in apps/ai/ai/brief.py. */
export const REPLY_DAYS = 3;
/** Urgent and important conversations quieter than this have had their moment. */
export const PRIORITY_DAYS = 7;
/** Updates are FYI and work conversations from the last day that the AI summarised. */
export const UPDATE_HOURS = 24;

const rank: Record<Priority, number> = { urgent: 0, important: 1, normal: 2, low: 3 };

export interface SummarySections {
  /** Waiting on your reply, most pressing first. */
  reply: Thread[];
  /** Urgent and important, not already waiting on a reply, most pressing first. */
  priority: Thread[];
  /** Recent FYI and work conversations with a summary, newest first. */
  updates: Thread[];
  /** Only under the Waiting On Others filter: you wrote last and nobody has replied for 2 days, quietest longest first. The other sections are empty then. */
  waiting: Thread[];
}

// Waiting has its own list (summarise), so here it is only ever a channel, Unread or nothing.
const matches = (t: Thread, filter: ListFilter) => filter === "waiting" || inFilter(t, filter);

// Urgent fades to Important a day after the latest message (priorityNow), so it sorts with the important ones.
const byPressing = (now: number) => (a: Thread, b: Thread) => rank[priorityNow(a, now)] - rank[priorityNow(b, now)] || Date.parse(b.lastMessageAt) - Date.parse(a.lastMessageAt);
const byNewest = (a: Thread, b: Thread) => Date.parse(b.lastMessageAt) - Date.parse(a.lastMessageAt);

const isPriorityCategory = (t: Thread) => t.category !== "newsletter" && t.category !== "notification";
const isPressing = (t: Thread) => t.priority === "urgent" || t.priority === "important";

/** Sorts inbox conversations into the Summary's sections. Each conversation appears once, in the first that fits. */
export function summarise(threads: Thread[], filter: ListFilter, now: Date = new Date()): SummarySections {
  // Waiting On Others is the other half of follow-up work, so it swaps the page's usual sections for its own list.
  if (filter === "waiting") {
    const waiting = threads.filter((t) => t.status === "inbox" && !t.junk && !isSnoozed(t, now.getTime()) && isWaiting(t, now.getTime()));
    return { reply: [], priority: [], updates: [], waiting: waiting.sort((a, b) => Date.parse(a.lastMessageAt) - Date.parse(b.lastMessageAt)) };
  }
  // Junk, archived and deleted conversations never need you, and nor does one you answered last: it waits
  // on them until they write again, whatever priority and category the AI gave it.
  // A snoozed one is off the page until its time passes, or until they write again (which clears the snooze).
  const open = threads.filter((t) => t.status === "inbox" && !t.junk && !t.lastFromMe && !isSnoozed(t, now.getTime()) && matches(t, filter));
  const within = (t: Thread, hours: number) => now.getTime() - Date.parse(t.lastMessageAt) <= hours * 3_600_000;

  // Only the needs-reply flag: the AI clears it once you have answered, while the category stays. A question about a
  // time that has already gone ("are you free at 3 today?") is past answering in time, so it waits in Older.
  const reply = open.filter((t) => t.needsReply && within(t, REPLY_DAYS * 24) && !(t.askedAt && Date.parse(t.askedAt) < now.getTime()));
  const taken = new Set(reply.map((t) => t.id));
  const priority = open.filter(
    (t) =>
      !taken.has(t.id) &&
      isPressing(t) &&
      isPriorityCategory(t) &&
      within(t, PRIORITY_DAYS * 24),
  );
  for (const t of priority) taken.add(t.id);
  const updates = open.filter((t) => !taken.has(t.id) && (t.category === "fyi" || t.category === "work") && t.summary.trim() && within(t, UPDATE_HOURS));

  const pressing = byPressing(now.getTime());
  return { reply: reply.sort(pressing), priority: priority.sort(pressing), updates: updates.sort(byNewest), waiting: [] };
}

/** How many conversations the page asks you to deal with: Needs Reply plus Important. The rail dot reads this, so it always agrees with the page. */
export function attentionCount(threads: Thread[], now: Date = new Date()): number {
  const { reply, priority } = summarise(threads, "none", now);
  return reply.length + priority.length;
}

/**
 * Conversations that still wait on you but have aged out of the page's windows: unanswered for longer than REPLY_DAYS
 * (or asking about a time that has passed), or marked urgent and quieter than PRIORITY_DAYS. The page lists them
 * under Older, newest first, so a lost client does not vanish without a trace. Important ones are left out: that would
 * be noise.
 */
export function olderWaiting(threads: Thread[], filter: ListFilter, now: Date = new Date()): Thread[] {
  if (filter === "waiting") return [];
  const { reply, priority } = summarise(threads, filter, now);
  const shown = new Set([...reply, ...priority].map((t) => t.id));
  return threads.filter(
    (t) =>
      t.status === "inbox" && !t.junk && !t.lastFromMe && !isSnoozed(t, now.getTime()) && matches(t, filter) && !shown.has(t.id) &&
      (t.needsReply || (t.priority === "urgent" && isPriorityCategory(t))),
  ).sort(byNewest);
}

/** One line for the top of the page, such as "3 Need a Reply, 2 Urgent or Important, 4 Events Today, 1 Task". Empty when there is nothing. */
export function digest(sections: SummarySections, events: number, tasks = 0): string {
  // Each count matches its section's badge.
  const reply = sections.reply.length;
  const priority = sections.priority.length;
  const updates = sections.updates.length;
  const waiting = sections.waiting.length;
  return [
    waiting > 0 && `${waiting} Waiting on Others`,
    reply > 0 && `${reply} ${reply === 1 ? "Needs" : "Need"} a Reply`,
    priority > 0 && `${priority} Urgent or Important`,
    events > 0 && `${events} ${events === 1 ? "Event" : "Events"} Today`,
    tasks > 0 && `${tasks} ${tasks === 1 ? "Task" : "Tasks"}`,
    updates > 0 && `${updates} ${updates === 1 ? "Update" : "Updates"}`,
  ]
    .filter(Boolean)
    .join(", ");
}
