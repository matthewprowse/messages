// The text of a push. Content-free by design: it says that something waits and which conversation, never who it is
// from, an address or any message text, because the push service (Apple, Google, Mozilla) carries it in the clear
// on its way to the device. The service worker (apps/web/public/sw.js) shows `title` and `body` and opens
// `/inbox/<threadId>`.

import type { PushKind } from "./policy";

export interface PushPayload {
  v: 1;
  kind: PushKind;
  threadId: string;
  title: string;
  body: string;
}

/** Builds the payload for one conversation. The thread id is the only variable part. */
export function buildPayload(kind: PushKind, threadId: string): PushPayload {
  return {
    v: 1,
    kind,
    threadId,
    title: kind === "urgent" ? "Urgent Message" : "New Message",
    body: kind === "urgent" ? "An urgent message from a client is waiting." : "New message from a client.",
  };
}
