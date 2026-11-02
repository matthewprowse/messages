"use client";

// Loads the AI's proposed next steps for one conversation (public.actions), opens their sealed arguments, and keeps them
// current by Realtime. Reads and marks only: proposing is the AI worker's job, and acting is the card's, on a click.

import { useCallback, useEffect, useState } from "react";
import { FIELD } from "@messages/crypto/fields";
import { supabase } from "@/lib/supabase";
import { open } from "@/lib/vault";
import { parseArgs, type ProposedAction } from "@/lib/action-cards";

async function load(threadId: string): Promise<ProposedAction[]> {
  const { data, error } = await supabase.from("actions").select("id, draft_id, thread_id, kind, args, status").eq("thread_id", threadId).eq("status", "proposed").order("created_at", { ascending: false }).limit(10);
  if (error || !data) return [];
  const out: ProposedAction[] = [];
  for (const r of data) {
    const args = parseArgs(r.kind, await open(FIELD.action, r.args));
    if (args && r.status === "proposed") out.push({ id: r.id, draftId: r.draft_id, threadId: r.thread_id, status: "proposed", args });
  }
  return out;
}

/** The waiting proposals for a conversation, and resolve() to mark one approved or dismissed (it leaves the list at once). */
export function useActions(threadId: string) {
  const [items, setItems] = useState<ProposedAction[]>([]);
  useEffect(() => {
    let live = true;
    setItems([]);
    const refresh = () => void load(threadId).then((rows) => { if (live) setItems(rows); }).catch(() => {});
    refresh();
    const channel = supabase.channel(`actions-${threadId}`).on("postgres_changes", { event: "INSERT", schema: "public", table: "actions", filter: `thread_id=eq.${threadId}` }, refresh).subscribe();
    return () => { live = false; void supabase.removeChannel(channel); };
  }, [threadId]);
  const resolve = useCallback(async (id: string, status: "approved" | "dismissed") => {
    setItems((rows) => rows.filter((r) => r.id !== id));
    // A failed mark only means the card may come back on the next load; what Approve did is already done and visible.
    await supabase.from("actions").update({ status, resolved_at: new Date().toISOString() }).eq("id", id);
  }, []);
  return { items, resolve };
}
