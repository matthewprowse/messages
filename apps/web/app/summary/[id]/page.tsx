"use client";

// The conversation opens beside the Summary, and Back, Escape and archiving return here.

import { useParams } from "next/navigation";
import { ThreadView } from "@/components/thread-view";

export default function SummaryThreadPage() {
  const { id } = useParams<{ id: string }>();
  return <ThreadView threadId={id} basePath="/summary" />;
}
