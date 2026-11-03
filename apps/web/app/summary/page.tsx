"use client";

// With no conversation open, the space beside the Summary is the same greeting, numbers and sent heatmap as the empty
// Conversations page, without its lists (the Summary beside it is those lists).

import { InboxHome } from "@/components/inbox-home";

export default function SummaryIndex() {
  return <InboxHome lists={false} />;
}
