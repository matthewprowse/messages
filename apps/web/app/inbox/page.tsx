"use client";

// /inbox with no conversation open: the list in the layout is the page, and the right pane says what is waiting
// (it is hidden on a phone). Also what shows after archiving the last conversation.

import { Inbox } from "lucide-react";
import { useApp } from "@/lib/store";
import { inboxCounts } from "@/lib/thread-list";
import { EmptyState } from "@/components/primitives";

export default function InboxIndex() {
  const { threads, loading } = useApp();
  const { unread, attention } = inboxCounts(threads);
  const parts = [
    unread > 0 && `${unread} unread`,
    attention > 0 && `${attention} ${attention === 1 ? "needs" : "need"} you`,
  ].filter(Boolean);
  return (
    <EmptyState
      icon={Inbox}
      title="Select a Conversation"
      description={loading ? undefined : parts.length ? `${parts.join(", ")}. Press J to open the first.` : "You are all caught up."}
    />
  );
}
