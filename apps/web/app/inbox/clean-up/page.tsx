"use client";

// /inbox/clean-up: the Clean Up review of bulk senders you have not opened for 90 days. Shows in the right pane of the Inbox.

import { CleanUp } from "@/components/clean-up/clean-up";

export default function CleanUpPage() {
  return <CleanUp />;
}
