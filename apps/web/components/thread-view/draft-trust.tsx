// Under an AI draft: chips for every number, date, time, amount and address in it (green Found when it is in the conversation,
// your notes or your calendar, amber Check This when it is not), a line saying what the draft was written from, and a thumbs up
// or down with an optional reason that the AI worker learns from. Shown only for the draft in the box as the AI wrote it.

import { useState } from "react";
import { Check, ThumbsDown, ThumbsUp, TriangleAlert } from "lucide-react";
import { toast } from "sonner";
import type { Draft } from "@/lib/types";
import { auditLine, FEEDBACK_REASONS, type FeedbackReason } from "@/lib/draft-trust";
import { supabase } from "@/lib/supabase";
import { track } from "@/lib/analytics";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";

/** The fact chips: unsupported details first, so the ones to check are the first thing read. */
function FactChips({ draft }: { draft: Draft }) {
  const r = draft.report;
  if (!r) return null;
  const missing = [...r.placeholders.map((text) => ({ text, found: false })), ...r.facts.filter((f) => !f.found)];
  const found = r.facts.filter((f) => f.found);
  if (!missing.length && !found.length) return null;
  return (
    <ul className="flex flex-wrap gap-1.5" aria-label="Details in this draft">
      {missing.map((f) => (
        <li key={`m-${f.text}`}>
          <Badge variant="outline" className="gap-1 border-amber-500/50 bg-amber-500/10 text-amber-700 dark:text-amber-300" title="Not in the conversation, your notes or your calendar">
            <TriangleAlert className="size-3" /> Check This: {f.text}
          </Badge>
        </li>
      ))}
      {found.map((f) => (
        <li key={`f-${f.text}`}>
          <Badge variant="outline" className="gap-1 border-green-600/40 bg-green-600/10 text-green-700 dark:text-green-300" title="Found in the conversation, your notes or your calendar">
            <Check className="size-3" /> Found: {f.text}
          </Badge>
        </li>
      ))}
    </ul>
  );
}

/** Thumbs up, or thumbs down with an optional reason. Saved on the draft; the choice shows at once. */
function Rating({ draft }: { draft: Draft }) {
  const [given, setGiven] = useState<{ id: string; value: "up" | "down" } | undefined>();
  const value = given?.id === draft.id ? given.value : draft.feedback;
  const rate = (next: "up" | "down", reason?: FeedbackReason) => {
    setGiven({ id: draft.id, value: next });
    track("draft_rated", { value: next, reason: reason ?? "none" });
    void supabase.from("drafts").update({ feedback: next, feedback_reason: reason ?? null, feedback_at: new Date().toISOString() }).eq("id", draft.id).then(({ error }) => {
      if (error) toast("Could not save your feedback. Try again.");
    });
  };
  return (
    <div className="flex items-center gap-1">
      <Button type="button" variant="ghost" size="icon" className={cn(value === "up" && "bg-accent")} aria-label="Good Draft" aria-pressed={value === "up"} onClick={() => rate("up")}><ThumbsUp /></Button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button type="button" variant="ghost" size="icon" className={cn(value === "down" && "bg-accent")} aria-label="Bad Draft" aria-pressed={value === "down"}><ThumbsDown /></Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {FEEDBACK_REASONS.map((r) => <DropdownMenuItem key={r.key} onSelect={() => rate("down", r.key)}>{r.label}</DropdownMenuItem>)}
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => rate("down")}>No Reason</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

export function DraftTrust({ draft }: { draft?: Draft }) {
  if (!draft || draft.tone === "edit" || draft.source !== undefined) return null;
  const audit = auditLine(draft.audit);
  if (!draft.report && !audit) return null;
  return (
    <div className="mt-2 flex flex-col gap-2">
      <FactChips draft={draft} />
      <div className="flex items-center justify-between gap-2">
        <p className="min-w-0 text-xs text-muted-foreground">{audit}</p>
        <Rating draft={draft} />
      </div>
    </div>
  );
}
