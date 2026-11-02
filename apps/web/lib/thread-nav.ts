// Where to go after a conversation leaves the list (archived, deleted, junked). Shared by the list's keys and bulk
// actions and by the open conversation's menu, so every route out of a conversation behaves the same.

import { advanceTarget, withQuery } from "./thread-list";

/** The md breakpoint: from here the list and the open conversation sit side by side. */
const WIDE_PX = 768;

/** Whether the list and the open conversation are on screen together (not the phone layout). */
export function sideBySide(): boolean {
  return typeof window !== "undefined" && window.matchMedia(`(min-width: ${WIDE_PX}px)`).matches;
}

/**
 * The address to go to once `gone` have left the list while `openId` is open. Side by side, the next conversation
 * opens (else the previous), so the right pane never goes blank; on a phone, or with nothing left, it is the list.
 * `replace` is used by callers, so Back does not return to a conversation that no longer exists.
 */
export function leaveHref(order: string[], gone: Iterable<string>, openId: string, basePath: string, query: string, wide: boolean, advance = true): string {
  const next = advance && wide ? advanceTarget(order, gone, openId) : null;
  return withQuery(next ? `${basePath}/${next}` : basePath, query);
}
