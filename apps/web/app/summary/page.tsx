"use client";

// With no conversation open, the space beside the Summary invites picking one.

import { MessageSquare } from "lucide-react";
import { EmptyState } from "@/components/primitives";

export default function BriefingIndex() {
  return <EmptyState icon={MessageSquare} title="Select a Conversation" description="Choose one from the Summary to read it here." />;
}
