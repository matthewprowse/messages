"use client";

// Under the header of an open conversation: a warning when the AI flagged the mail as likely phishing or payment fraud
// (it only warns, nothing is blocked or done), and one quiet line with why the conversation is labelled as it is, with
// Not Right? choices. Shows nothing when there is nothing to say.

import { ShieldAlert } from "lucide-react";
import type { Thread } from "@/lib/types";
import { SUSPICIOUS_COPY, notRightOptions, whyText } from "@/lib/triage-why";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { useNotRight } from "./use-not-right";
import { useTriageNote } from "./use-triage-note";

export function TriageNotes({ thread }: { thread: Thread }) {
  const note = useTriageNote(thread.id, thread.lastMessageAt);
  const notRight = useNotRight();
  if (!note) return null;
  const warning = note.suspicious ? SUSPICIOUS_COPY[note.suspicious] : undefined;
  const text = whyText(note.code, note.words);
  const options = notRightOptions(thread);
  // Quiet conversations need no explanation: only what is marked Urgent, Needs Reply or Junk has one.
  const marked = thread.junk || thread.priority === "urgent" || (thread.needsReply && !thread.lastFromMe);
  if (!warning && !(text && marked)) return null;
  return (
    <div className="shrink-0 space-y-2 border-b bg-background px-3 py-2 md:px-4">
      {warning && (
        <Alert variant="destructive">
          <ShieldAlert />
          <AlertTitle>{warning.title}</AlertTitle>
          <AlertDescription>{warning.text}</AlertDescription>
        </Alert>
      )}
      {text && marked && (
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
          <span>Why: {text}</span>
          {options.length > 0 && <span>Not Right?</span>}
          {options.map((o) => <Button key={o.value} type="button" size="xs" variant="secondary" onClick={() => notRight(thread.id, o.value)}>{o.label}</Button>)}
        </div>
      )}
    </div>
  );
}
