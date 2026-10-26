import type { ListFilter, Priority, Thread } from "./types";

// What the Summary page gathers from your conversations. It is worked out in the browser from the labels
// the AI already puts on each conversation: whether it needs a reply, its priority, category and summary.

/** Conversations waiting on a reply for longer than this are left to Conversations. */
export const REPLY_DAYS = 14;
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
}

function matches(t: Thread, filter: ListFilter) {
  switch (filter) {
    case "unread": return t.unread;
    case "email": return t.channel === "email";
    case "whatsapp": return t.channel === "whatsapp";
    default: return true;
  }
}

const byPressing = (a: Thread, b: Thread) => rank[a.priority] - rank[b.priority] || Date.parse(b.lastMessageAt) - Date.parse(a.lastMessageAt);
const byNewest = (a: Thread, b: Thread) => Date.parse(b.lastMessageAt) - Date.parse(a.lastMessageAt);

/** Sorts inbox conversations into the Summary's sections. Each conversation appears once, in the first that fits. */
export function summarise(threads: Thread[], filter: ListFilter, now: Date = new Date()): SummarySections {
  // Junk, archived and deleted conversations never need you, and nor does one you answered last: it waits
  // on them until they write again, whatever priority and category the AI gave it.
  const open = threads.filter((t) => t.status === "inbox" && !t.junk && !t.lastFromMe && matches(t, filter));
  const within = (t: Thread, hours: number) => now.getTime() - Date.parse(t.lastMessageAt) <= hours * 3_600_000;

  // Only the needs-reply flag: the AI clears it once you have answered, while the category stays.
  const reply = open.filter((t) => t.needsReply && within(t, REPLY_DAYS * 24));
  const taken = new Set(reply.map((t) => t.id));
  const priority = open.filter(
    (t) =>
      !taken.has(t.id) &&
      (t.priority === "urgent" || t.priority === "important") &&
      t.category !== "newsletter" &&
      t.category !== "notification" &&
      within(t, PRIORITY_DAYS * 24),
  );
  for (const t of priority) taken.add(t.id);
  const updates = open.filter((t) => !taken.has(t.id) && (t.category === "fyi" || t.category === "work") && t.summary.trim() && within(t, UPDATE_HOURS));

  return { reply: reply.sort(byPressing), priority: priority.sort(byPressing), updates: updates.sort(byNewest) };
}

/** One line for the top of the page, such as "3 Need a Reply, 2 Urgent or Important, 4 Events Today, 1 Task". Empty when there is nothing. */
export function digest(sections: SummarySections, events: number, tasks = 0): string {
  // Each count matches its section's badge.
  const reply = sections.reply.length;
  const priority = sections.priority.length;
  const updates = sections.updates.length;
  return [
    reply > 0 && `${reply} ${reply === 1 ? "Needs" : "Need"} a Reply`,
    priority > 0 && `${priority} Urgent or Important`,
    events > 0 && `${events} ${events === 1 ? "Event" : "Events"} Today`,
    tasks > 0 && `${tasks} ${tasks === 1 ? "Task" : "Tasks"}`,
    updates > 0 && `${updates} ${updates === 1 ? "Update" : "Updates"}`,
  ]
    .filter(Boolean)
    .join(", ");
}
