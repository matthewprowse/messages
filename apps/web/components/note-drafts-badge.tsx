"use client";

// The mark that says a note is given to the AI with every draft ("Use in Drafts"), on a list row and in the open
// note's header. A note the AI worker cuts short or leaves out because of its limits (lib/note-facts.ts) says so, so
// nobody trusts a fact that never reaches a draft.

import { useMemo } from "react";
import { Sparkles, TriangleAlert } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { FACT_NOTES, FACTS_CHARS, FACT_NOTE_CHARS, draftFacts, factStatus, type FactsReport } from "@/lib/note-facts";
import type { Note } from "@/lib/notes";

/** What drafts take from the notes now, recomputed when the list changes. */
export function useDraftFacts(notes: Note[]): FactsReport {
  return useMemo(() => draftFacts(notes), [notes]);
}

const LIMITS = `Drafts use up to ${FACT_NOTES} notes, ${FACT_NOTE_CHARS.toLocaleString("en-ZA")} characters from each and ${FACTS_CHARS.toLocaleString("en-ZA")} in all.`;

export type DraftsStatus = ReturnType<typeof factStatus>;

/** A small badge for one note; nothing when the note is not used in drafts. */
export function DraftsBadge({ status }: { status: DraftsStatus }) {
  if (status === "off") return null;
  const warn = status !== "used";
  const label = status === "left-out" ? "Left Out of Drafts" : status === "cut" ? "Cut Short in Drafts" : "Used in Drafts";
  const Icon = warn ? TriangleAlert : Sparkles;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Badge variant={warn ? "destructive" : "secondary"} className="shrink-0"><Icon />{label}</Badge>
      </TooltipTrigger>
      <TooltipContent className="max-w-64">{warn ? `${LIMITS} This note does not fit.` : "Every draft is given this note."}</TooltipContent>
    </Tooltip>
  );
}
