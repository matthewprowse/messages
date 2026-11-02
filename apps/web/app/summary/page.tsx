"use client";

// With no conversation open, the space beside the Summary says what is waiting, or invites picking one.

import { useMemo } from "react";
import { MessageSquare } from "lucide-react";
import { EmptyState } from "@/components/primitives";
import { useNow } from "@/components/summary/use-now";
import { useApp } from "@/lib/store";
import { digest, summarise } from "@/lib/summary";

/** Same slow clock as the list beside it, so the two never disagree. */
const REFRESH_MS = 5 * 60_000;

export default function SummaryIndex() {
  const { threads } = useApp();
  const now = useNow(REFRESH_MS);
  const headline = useMemo(() => digest(summarise(threads, "none", now), 0), [threads, now]);
  return <EmptyState icon={MessageSquare} title="Select a Conversation" description={headline ? `${headline}. Choose one from the Summary to read it here.` : "Choose one from the Summary to read it here."} />;
}
