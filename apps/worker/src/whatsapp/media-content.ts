// Finds the media part of a WhatsApp message. Pure: no network, no database. Used when a message is prepared for storage.

import type { proto } from "baileys";
import type { mediaRef } from "./media";

/** The media part of a message, after unwrapping disappearing, view once and captioned documents. */
export function mediaContent(message: proto.IMessage, type: string | undefined) {
  if (!type) return null;
  let content: proto.IMessage | null | undefined = message;
  for (let i = 0; i < 5 && content; i++) {
    const inner: proto.IMessage | null | undefined =
      content.ephemeralMessage?.message ??
      content.viewOnceMessage?.message ??
      content.viewOnceMessageV2?.message ??
      content.viewOnceMessageV2Extension?.message ??
      content.documentWithCaptionMessage?.message;
    if (!inner) break;
    content = inner;
  }
  return (content as Record<string, unknown> | null | undefined)?.[type] as Parameters<typeof mediaRef>[1] | null;
}
