// Watches freshly queued mail_actions rows until the worker has finished them, and tells the user when one failed.
// Polls only the rows this tab just inserted (a few reads over about two minutes) instead of a Realtime
// subscription, so it needs no change to the shared realtime effect.

import { toast } from "sonner";
import { supabase } from "../supabase";
import { WATCH_DELAYS_MS, failureText, stillOpen, type ActionRow } from "../mail-action-failures";

/** Looks at the rows after each delay in WATCH_DELAYS_MS, and toasts once if any failed. Never throws. */
export function watchMailActions(ids: string[]) {
  if (ids.length === 0 || typeof window === "undefined") return;
  const look = async (attempt: number) => {
    let rows: ActionRow[] = [];
    try {
      const { data } = await supabase.from("mail_actions").select("action, status, error").in("id", ids);
      rows = data ?? [];
    } catch { /* a network blip: try again at the next delay */ }
    const text = failureText(rows);
    if (text) { toast(text, { duration: 10_000 }); return; }
    const next = WATCH_DELAYS_MS[attempt + 1];
    if (next !== undefined && (rows.length === 0 || stillOpen(rows))) setTimeout(() => look(attempt + 1), next - WATCH_DELAYS_MS[attempt]);
  };
  setTimeout(() => look(0), WATCH_DELAYS_MS[0]);
}
