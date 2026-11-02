// "Also in N conversations": identical files are stored once, so the same file can sit in several conversations. The
// database function attachment_copies finds the other rows; this turns them into the distinct conversations to link to.
// Pure and tested; the call itself is in load-copies.ts.

export type CopyRow = { attachment_id: string; message_id: string; thread_id: string };
/** One other conversation holding the file, with the first message there that carries it. */
export type OtherConversation = { threadId: string; messageId: string };

/** Distinct conversations other than the one being viewed, in the order found. */
export function groupCopies(rows: CopyRow[], currentThreadId: string): OtherConversation[] {
  const seen = new Set<string>([currentThreadId]);
  const out: OtherConversation[] = [];
  for (const r of rows) {
    if (seen.has(r.thread_id)) continue;
    seen.add(r.thread_id);
    out.push({ threadId: r.thread_id, messageId: r.message_id });
  }
  return out;
}

/** "Also in 1 Conversation" or "Also in 3 Conversations". */
export const alsoInLabel = (n: number) => `Also in ${n.toLocaleString()} ${n === 1 ? "Conversation" : "Conversations"}`;

/** The address of a message in its conversation, as the Attachments page links to it. */
export const copyHref = (c: OtherConversation) => `/inbox/${c.threadId}?message=${c.messageId}`;
