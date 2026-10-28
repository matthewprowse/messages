"use client";

import { useParams } from "next/navigation";
import { ThreadView } from "@/components/thread-view";

// The conversation opens beside the Summary, and Back, Escape and archiving return here.
export default function BriefingThreadPage() {
  const { id } = useParams<{ id: string }>();
  return <ThreadView threadId={id} basePath="/summary" />;
}
