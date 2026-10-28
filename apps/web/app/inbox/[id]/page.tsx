"use client";

// An open conversation in the Inbox, by thread id.

import { useParams } from "next/navigation";
import { ThreadView } from "@/components/thread-view";

export default function ThreadPage() {
  const { id } = useParams<{ id: string }>();
  return <ThreadView threadId={id} />;
}
