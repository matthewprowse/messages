// "Reply With These Points" on a voice note: the bubble cannot reach the composer's draft request, so it announces the ask here and
// the composer of that conversation (the only listener) asks for a draft that covers the voice note. The wording is English
// because the interface is; the reply follows the language of the voice note (drafts_prompt.VOICE_NOTE_NOTE).

const EVENT = "konva:voice-reply";

/** What is typed into the draft request, so the person sees what was asked and can change it for another try. */
export const VOICE_REPLY_INSTRUCTION = "Reply to every point in their voice note";

/** Asks the open conversation for a draft that answers its voice note. */
export function askVoiceReply(threadId: string) {
  if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent(EVENT, { detail: { threadId } }));
}

/** Calls onAsk when this conversation's voice note asks for a reply. Returns the way to stop listening. */
export function onVoiceReply(threadId: string, onAsk: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  const listener = (e: Event) => { if ((e as CustomEvent<{ threadId: string }>).detail?.threadId === threadId) onAsk(); };
  window.addEventListener(EVENT, listener);
  return () => window.removeEventListener(EVENT, listener);
}
