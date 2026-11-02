// Waits for the worker to settle a queued task tick, by Realtime updates with a polling fallback.


import { supabase } from "../supabase";

/**
 * Waits for the worker to settle a queued tick, by the row's Realtime updates with a poll as a safety net, like
 * Calendar's followUpdate. Resolves with the row then (done, or failed with the reason), or as failed after giveUpMs.
 */
export function followTaskUpdate(id: string, giveUpMs = 60_000, pollMs = 2000, giveUpText = "Ticking the task is taking too long. Please try again in a moment."): Promise<{ status: string; error: string | null }> {
  return new Promise((resolve) => {
    let finished = false;
    const finish = (row: { status: string; error: string | null }) => {
      if (finished) return;
      finished = true;
      clearInterval(poll);
      clearTimeout(giveUp);
      void supabase.removeChannel(channel);
      resolve(row);
    };
    const apply = (row: { status: string; error: string | null } | null) => {
      if (row && (row.status === "done" || row.status === "failed")) finish(row);
    };
    const channel = supabase
      .channel(`task_updates-${id}`)
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "task_updates", filter: `id=eq.${id}` }, (payload) => apply(payload.new as { status: string; error: string | null }))
      .subscribe();
    const poll = setInterval(() => void supabase.from("task_updates").select("status, error").eq("id", id).maybeSingle().then(({ data }) => apply(data)), pollMs);
    const giveUp = setTimeout(() => finish({ status: "failed", error: giveUpText }), giveUpMs);
  });
}
