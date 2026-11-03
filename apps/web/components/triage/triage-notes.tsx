"use client";

// Under the header of an open conversation: a warning when the AI flagged the mail as likely phishing or payment fraud
// (it only warns, nothing is blocked or done). Shows nothing otherwise. Why a conversation is labelled as it is shows on
// the list row's tag (why-tag.tsx), not here.

import { ShieldAlert } from "lucide-react";
import type { Thread } from "@/lib/types";
import { SUSPICIOUS_COPY } from "@/lib/triage-why";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { useTriageNote } from "./use-triage-note";

export function TriageNotes({ thread }: { thread: Thread }) {
  const note = useTriageNote(thread.id, thread.lastMessageAt);
  if (!note?.suspicious) return null;
  const warning = SUSPICIOUS_COPY[note.suspicious];
  if (!warning) return null;
  return (
    <div className="shrink-0 px-3 pb-2 md:px-4">
      <Alert variant="destructive">
        <ShieldAlert />
        <AlertTitle>{warning.title}</AlertTitle>
        <AlertDescription>{warning.text}</AlertDescription>
      </Alert>
    </div>
  );
}
