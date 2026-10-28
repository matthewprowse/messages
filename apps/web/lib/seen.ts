// Which message gets the "Seen" label on Instagram and LinkedIn: only the last message you sent that the other
// person has seen, as Messages shows it. Earlier seen messages show nothing. WhatsApp keeps its ticks instead.

import type { Message } from "./types";

/** The id of the message that shows "Seen", or null. msgs are oldest first. */
export function seenLabelId(msgs: Pick<Message, "id" | "from" | "receipt" | "sendState">[], channel: string): string | null {
  if (channel !== "instagram" && channel !== "linkedin") return null;
  for (let i = msgs.length - 1; i >= 0; i--) {
    const m = msgs[i];
    if (m.from === "me" && !m.sendState && m.receipt === "read") return m.id;
  }
  return null;
}
