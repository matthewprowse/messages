"use client";

// /inbox with no conversation open: the list in the layout is the page, and the right pane shows what is waiting and
// what you have sent (it is hidden on a phone). Also what shows after archiving the last conversation.

import { InboxHome } from "@/components/inbox-home";

export default function InboxIndex() {
  return <InboxHome />;
}
