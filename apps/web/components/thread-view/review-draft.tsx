"use client";

// A pre-draft the AI worker held back for checking (drafts.status 'review': it repeats details only the sender gave). It is
// never put in the reply box on its own: the composer offers it with a warning, and once used the warning stays above the
// box while that draft is in it. Dismissing it marks it discarded, as Discard does for a live draft.

import { TriangleAlert } from "lucide-react";
import { toast } from "sonner";
import type { Thread } from "@/lib/types";
import { REVIEW_WARNING } from "@/lib/draft-trust";
import { useApp } from "@/lib/store";
import { supabase } from "@/lib/supabase";
import { Button } from "@/components/ui/button";

/** The warning line for a held draft. */
export function ReviewWarning() {
  return (
    <p className="flex items-center gap-1.5 text-xs text-amber-700 dark:text-amber-300" role="note">
      <TriangleAlert className="size-3.5 shrink-0" /> {REVIEW_WARNING}
    </p>
  );
}

/** The offer of a held draft, with Use This Draft and Dismiss. Nothing once it is the draft in the box. */
export function ReviewDraftOffer({ thread, disabled }: { thread: Thread; disabled: boolean }) {
  const { dispatch } = useApp();
  const held = thread.reviewDraft;
  if (!held || thread.draft?.id === held.id) return null;
  // Asked for by a click, so it replaces whatever is in the box, as a draft you ask for does.
  const use = () => dispatch({ type: "setDraft", id: thread.id, draft: { ...held, auto: false } });
  const dismiss = () => {
    dispatch({ type: "setReviewDraft", id: thread.id });
    void supabase.from("drafts").update({ status: "discarded" }).eq("id", held.id).eq("status", "review").then(({ error }) => {
      if (!error) return;
      dispatch({ type: "setReviewDraft", id: thread.id, draft: held });
      toast("Could not dismiss the draft. Try again.");
    });
  };
  return (
    <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
      <ReviewWarning />
      <div className="flex items-center gap-1">
        <Button type="button" variant="ghost" size="xs" disabled={disabled} onClick={dismiss}>Dismiss</Button>
        <Button type="button" variant="secondary" size="xs" disabled={disabled} onClick={use}>Use This Draft</Button>
      </div>
    </div>
  );
}
