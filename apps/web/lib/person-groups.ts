// Groups the Inbox list's conversations by person for the By Person toggle: one row per contact (merged contacts are one
// contact already, so their email, WhatsApp, LinkedIn and Instagram threads land together). Pure: PersonRow renders it.

import type { Channel, Thread } from "./types";

/** One row of the By Person list: a person with all their listed one-to-one conversations, or a conversation that has no single person (a group). */
export interface PersonGroup {
  /** The contact id, or the thread id for a group or a conversation with nobody saved. */
  key: string;
  /** Set when the row is a person: their timeline opens at /inbox/person/<id>. */
  personId?: string;
  /** Newest first. */
  threads: Thread[];
  /** The thread with the newest message, which gives the row its preview and time. */
  newest: Thread;
  /** The channels they are on, the one with the newest message first. */
  channels: Channel[];
  /** Unread messages across the group. */
  unread: number;
  pinned: boolean;
}

/** The contact a one-to-one conversation is with; undefined for a group or when nobody is saved. */
export function personOf(t: Thread): string | undefined {
  return t.isGroup ? undefined : t.participantIds[0];
}

/**
 * The listed threads as one row per person, in the order each person first appears (so pinned and newest-first order of the
 * input is kept). Groups stay rows of their own. Callers pass the already filtered and searched threads.
 */
export function groupByPerson(threads: Thread[]): PersonGroup[] {
  const byKey = new Map<string, Thread[]>();
  for (const t of threads) {
    const key = personOf(t) ?? t.id;
    const list = byKey.get(key);
    if (list) list.push(t); else byKey.set(key, [t]);
  }
  const newestFirst = (a: Thread, b: Thread) => b.lastMessageAt.localeCompare(a.lastMessageAt);
  return [...byKey].map(([key, list]) => {
    const sorted = [...list].sort(newestFirst);
    const channels: Channel[] = [];
    for (const t of sorted) if (!channels.includes(t.channel)) channels.push(t.channel);
    return {
      key,
      personId: personOf(sorted[0]),
      threads: sorted,
      newest: sorted[0],
      channels,
      unread: list.reduce((n, t) => n + (t.unread ? Math.max(t.unreadCount, 1) : 0), 0),
      pinned: list.some((t) => t.pinned),
    };
  });
}

/** Where a row opens: a person's timeline, or the conversation itself for a group. */
export function personHref(g: PersonGroup, query = ""): string {
  const path = g.personId ? `/inbox/person/${g.personId}` : `/inbox/${g.newest.id}`;
  return query ? `${path}?${query}` : path;
}
