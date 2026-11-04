// "Same Matter?" prompts above a person's timeline: an email thread and a chat that look like the same job, with Link and
// Not the Same. Linking draws them together in the timeline under one heading; Not the Same stops the suggestion returning.

import { Link2 } from "lucide-react";
import type { Thread } from "@/lib/types";
import { threadLabel } from "@/lib/person-timeline";
import type { ThreadLink } from "@/lib/thread-links";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";

export function MatterSuggestions({ suggestions, threads, onLink, onDismiss }: {
  suggestions: ThreadLink[];
  threads: Thread[];
  onLink: (l: ThreadLink) => void;
  onDismiss: (l: ThreadLink) => void;
}) {
  const byId = new Map(threads.map((t) => [t.id, t]));
  // One at a time, so the timeline is not buried under prompts; the next appears after an answer.
  const l = suggestions[0];
  const a = l && byId.get(l.threadA);
  const b = l && byId.get(l.threadB);
  if (!l || !a || !b) return null;
  return (
    <Alert className="mb-4">
      <Link2 />
      <AlertTitle>Same Matter?</AlertTitle>
      <AlertDescription>
        <p className="truncate">{threadLabel(a)} and {threadLabel(b)} look like the same matter. Show them together?</p>
        <div className="mt-2 flex gap-2">
          <Button onClick={() => onLink(l)}>Link Them</Button>
          <Button variant="ghost" onClick={() => onDismiss(l)}>Not the Same</Button>
        </div>
      </AlertDescription>
    </Alert>
  );
}
