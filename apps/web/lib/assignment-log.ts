"use client";

// Loads the assignment log the signed-in person may read (row level security: the chat's agent, its assignees then and now,
// and the team owner) and keeps it live over Realtime. Only self-assignments are fetched: they are all the app shows
// (lib/assignment-notices.ts decides to whom).

import { useEffect, useState } from "react";
import { supabase } from "./supabase";
import { useAuth } from "./auth";
import { ASSIGNMENT_COLUMNS, mapAssignment, type AssignmentEntry, type AssignmentRow } from "./assignment-notices";

const LOG_ROWS = 200;

/** Self-assignments in the log, for one chat or (without threadId) every chat this person may see. Null while loading or when it failed. */
export function useAssignmentLog(threadId?: string): AssignmentEntry[] | null {
  const userId = useAuth().session?.user.id;
  const [entries, setEntries] = useState<AssignmentEntry[] | null>(null);
  useEffect(() => {
    if (!userId) return;
    let alive = true;
    const load = async () => {
      let q = supabase.from("thread_assignment_log").select(ASSIGNMENT_COLUMNS).eq("self_assigned", true);
      if (threadId) q = q.eq("thread_id", threadId);
      const { data, error } = await q.order("assigned_at", { ascending: false }).limit(LOG_ROWS);
      if (alive && !error) setEntries(((data ?? []) as AssignmentRow[]).map(mapAssignment));
    };
    void load();
    const channel = supabase.channel(`assignment-log-${threadId ?? "all"}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "thread_assignment_log", ...(threadId ? { filter: `thread_id=eq.${threadId}` } : {}) }, () => void load())
      .subscribe();
    return () => { alive = false; void supabase.removeChannel(channel); };
  }, [userId, threadId]);
  return entries;
}
