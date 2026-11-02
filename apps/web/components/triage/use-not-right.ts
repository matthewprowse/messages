"use client";

// "Not Right?": says a label is wrong. Each choice goes down the corrections path the AI already learns from: Not Junk and
// Not Important are the existing actions, and No Reply Needed is a new kind of feedback that also clears the tag at once.

import { useCallback } from "react";
import { toast } from "sonner";
import { useAuth } from "@/lib/auth";
import { supabase } from "@/lib/supabase";
import { useApp } from "@/lib/store";
import type { NotRight } from "@/lib/triage-why";

/** Applies one "Not Right?" choice to a conversation. */
export function useNotRight() {
  const { giveFeedback, setJunk } = useApp();
  const userId = useAuth().session?.user.id;
  return useCallback((threadId: string, choice: NotRight["value"]) => {
    if (!userId) return;
    if (choice === "not_junk") return setJunk(threadId, false);
    if (choice === "not_important") return giveFeedback(threadId, "not_important");
    // The tag leaves when the row update comes back through Realtime; the feedback is what the AI learns from.
    Promise.all([
      supabase.from("feedback").insert({ user_id: userId, thread_id: threadId, value: "no_reply_needed" }),
      supabase.from("threads").update({ needs_reply: false }).eq("id", threadId),
    ]).then((results) => toast(results.some((r) => r.error) ? "Could not save that. Try again." : "Marked as no reply needed"));
  }, [giveFeedback, setJunk, userId]);
}
