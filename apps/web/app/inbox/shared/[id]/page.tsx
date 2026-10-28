"use client";

import { useParams } from "next/navigation";
import { SharedChatView } from "@/components/shared-chat-view";

// A shared chat opened by someone who is not its agent: an assignee, a member of its shared inbox, or Compliance.
export default function SharedChatPage() {
  const { id } = useParams<{ id: string }>();
  return <SharedChatView threadId={id} />;
}
