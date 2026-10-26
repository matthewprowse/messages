"use client";

import { MessageSquare } from "lucide-react";
import { EmptyState } from "@/components/primitives";

// With no conversation open, the space beside the Summary invites picking one.
export default function BriefingIndex() {
  return <EmptyState icon={MessageSquare} title="Select a Conversation" description="Choose one from the Summary to read it here." />;
}
