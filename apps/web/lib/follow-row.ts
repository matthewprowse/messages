import { supabase } from "./supabase";

/**
 * Waits for a row the worker is acting on (a queued event or delete) to reach a final status, by its Realtime
 * updates with a poll as a safety net. Resolves with the row at that point, or with `timedOut` after giveUpMs.
 */
export function followRow<T extends { status: string; error: string | null }>(
  table: "calendar_outbox" | "calendar_deletes",
  id: string,
  columns: string,
  isFinal: (row: T) => boolean,
  timedOut: T,
  { giveUpMs = 60_000, pollMs = 1500 }: { giveUpMs?: number; pollMs?: number } = {},
): Promise<T> {
  return new Promise((resolve) => {
    let finished = false;
    const finish = (row: T) => {
      if (finished) return;
      finished = true;
      clearInterval(poll);
      clearTimeout(giveUp);
      supabase.removeChannel(channel);
      resolve(row);
    };
    const apply = (row: T | null) => { if (row && isFinal(row)) finish(row); };
    const channel = supabase
      .channel(`${table}-${id}`)
      .on("postgres_changes", { event: "UPDATE", schema: "public", table, filter: `id=eq.${id}` }, (payload) => apply(payload.new as T))
      .subscribe();
    const poll = setInterval(() => void supabase.from(table).select(columns).eq("id", id).maybeSingle().then(({ data }) => apply(data as unknown as T | null)), pollMs);
    const giveUp = setTimeout(() => finish(timedOut), giveUpMs);
  });
}
