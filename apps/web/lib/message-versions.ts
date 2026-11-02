// What a WhatsApp message said before its sender edited or deleted it. The worker keeps each earlier text sealed in
// message_versions; data/load-versions.ts reads and opens them. The first one is the original. Pure.

export interface MessageVersion {
  reason: "edited" | "deleted";
  text: string;
  /** When it was set aside: when the edit or the deletion reached Konva. */
  at: string;
}

/** The earliest kept text: what the message said when it was first sent. Null when nothing was kept. */
export function originalOf(versions: MessageVersion[]): MessageVersion | null {
  return versions.reduce<MessageVersion | null>((first, v) => (!first || Date.parse(v.at) < Date.parse(first.at) ? v : first), null);
}
