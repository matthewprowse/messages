// When an open conversation is marked read by itself. Pure: ThreadView arms a timer from it.
// The rule: once per arrival (opening it, or a new message landing while it is open), never because the unread flag
// flipped on its own, or "Mark as Unread" on the open conversation would be undone two seconds later.

/** The key of one arrival: the conversation and its latest message time. A new message makes a new key. */
export function readKey(threadId: string, lastMessageAt: string): string {
  return `${threadId}:${lastMessageAt}`;
}

/** Whether to arm the read timer: the conversation is unread, and this arrival has not already been marked read. */
export function shouldAutoRead(unread: boolean, key: string, markedKey: string | null): boolean {
  return unread && key !== markedKey;
}

/** A tab title with the unread count in front, "(3) Inbox"; the bare title when nothing is unread. Strips a count already there. */
export function titleWithCount(title: string, unread: number): string {
  const bare = title.replace(/^\(\d+\+?\) /, "");
  return unread > 0 ? `(${unread > 99 ? "99+" : unread}) ${bare}` : bare;
}
