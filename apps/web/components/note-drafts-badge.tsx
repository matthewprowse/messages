"use client";

// The mark that says a note is given to the AI with every draft ("Use in Drafts"), on a list row and in the open
// note's header, and the summary line over the list. A note the AI worker cuts short or leaves out because of its
// limits (lib/note-facts.ts) says so, so nobody trusts a fact that never reaches a draft.

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

/** One line over the list: how many notes drafts use, and a warning when some are cut or left out. */
export function DraftsSummary({ report }: { report: FactsReport }) {
  if (report.marked === 0) return null;
  const left = report.leftOut.size;
  const cut = report.shortened.size;
  return (
    <p className="flex items-center gap-1.5 border-b px-3 py-2 text-xs text-muted-foreground" role="status">
      <Sparkles className="size-3 shrink-0" />
      <span>
        {report.used} of {report.marked} {report.marked === 1 ? "Note" : "Notes"} Used in Drafts
        {(left > 0 || cut > 0) && <span className="text-destructive">. {[left > 0 && `${left} left out`, cut > 0 && `${cut} cut short`].filter(Boolean).join(" and ")} by the limits</span>}
      </span>
    </p>
  );
}
