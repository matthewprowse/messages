// Helpers for keeping a shared chat's timeline when it reloads, so a reload does not drop the older messages the person scrolled back to.

import type { Message } from "./types";

/** How many messages a shared chat opens with, and how many a reload reads. Older ones load on request. */
export const SHARED_PAGE = 50;

/** What the cheap change check compares: how many messages the chat has and which is newest. */
export interface ChatMark { count: number; newestId: string | null; newestAt: string | null }

export function sameMark(a: ChatMark | null, b: ChatMark): boolean {
  return !!a && a.count === b.count && a.newestId === b.newestId && a.newestAt === b.newestAt;
}

/** The held messages with a freshly read newest page laid over them: older held ones are kept, the page wins where they overlap. */
export function overlayPage<T extends Pick<Message, "id" | "sentAt">>(held: T[], page: T[]): T[] {
  if (page.length === 0) return held;
  const first = page[0];
  const ids = new Set(page.map((m) => m.id));
  const older = held.filter((m) => !ids.has(m.id) && (m.sentAt < first.sentAt || (m.sentAt === first.sentAt && m.id < first.id)));
  return [...older, ...page];
}
