// Puts the text of an undone or edited message back in its conversation's reply box. If that box is open it hears the
// event; if the person has moved on, the text waits here and the box takes it when that conversation opens again.

const waiting = new Map<string, string>();
const EVENT = "konva:restore-reply";

/** Hands text back to a conversation's reply box. */
export function restoreReply(threadId: string, body: string) {
  waiting.set(threadId, body);
  if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent(EVENT, { detail: { threadId } }));
}

/** The text waiting for this conversation, once: reading it clears it. */
export function takeRestored(threadId: string): string | undefined {
  const body = waiting.get(threadId);
  waiting.delete(threadId);
  return body;
}

/** Calls onRestore when text is handed back to this conversation. Returns the way to stop listening. */
export function onRestoreReply(threadId: string, onRestore: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  const listener = (e: Event) => { if ((e as CustomEvent<{ threadId: string }>).detail?.threadId === threadId) onRestore(); };
  window.addEventListener(EVENT, listener);
  return () => window.removeEventListener(EVENT, listener);
}
