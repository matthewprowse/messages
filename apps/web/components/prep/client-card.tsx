"use client";

// The Summary card on a contact's page: their summary with the client card folded in, the AI paragraph on where things
// stand with them, and Refresh (capped per day) as the card's action. The worker writes the client card; Refresh only
// asks, so the new text appears a little later.

import { useCallback, useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { loadClientCard, requestCardRefresh, type ClientCardState } from "@/lib/prep";
import { Card } from "@/components/surface";
import { IconAction } from "@/components/tip";
import { timeAgo } from "./time-ago";

const POLL_MS = 10_000;
const POLLS = 12; // two minutes of looking for the new card, then it shows when the page is next opened

/** The contact's client card, and Refresh, which polls for the new one for a while after asking. */
function useClientCard(contactId: string) {
  const [state, setState] = useState<ClientCardState | null>(null);
  const [asking, setAsking] = useState(false);
  const [watching, setWatching] = useState(0);

  const load = useCallback(() => loadClientCard(contactId).then(setState, () => undefined), [contactId]);
  useEffect(() => {
    setState(null);
    void load();
  }, [load]);

  // After an ask, look for the answer every few seconds for a while.
  useEffect(() => {
    if (watching <= 0) return;
    const t = setTimeout(() => {
      void load();
      setWatching((n) => n - 1);
    }, POLL_MS);
    return () => clearTimeout(t);
  }, [watching, load]);
  useEffect(() => {
    if (state && !state.pending) setWatching(0);
  }, [state]);

  const refresh = async () => {
    setAsking(true);
    const left = await requestCardRefresh(contactId);
    setAsking(false);
    if (left === null) {
      toast.error("No Refreshes Left Today");
      void load();
      return;
    }
    setState((s) => (s ? { ...s, pending: true, left } : s));
    setWatching(POLLS);
  };
  return { state, busy: asking || !!state?.pending, refresh };
}

/** Summary on a contact's Overview: the stored summary and the client card under it, with Refresh. */
export function SummaryCard({ contactId, summary }: { contactId: string; summary: string | null }) {
  const { state, busy, refresh } = useClientCard(contactId);
  // Until the client card has been read there is nothing to refresh, so a contact without a summary shows nothing yet.
  if (!state && !summary) return null;
  const when = state?.pending ? "Refreshing" : state?.updatedAt && state.card ? `Updated ${timeAgo(state.updatedAt)}` : "";
  return (
    <Card
      title="Summary"
      action={state && <IconAction label={state.left === 0 ? "Refreshed Today" : "Refresh"} icon={RefreshCw} disabled={busy || state.left === 0} onClick={() => void refresh()} />}
    >
      <div className="flex flex-col gap-3 px-3 pb-3 text-sm leading-6">
        {summary && <p>{summary}</p>}
        {state?.card && <p className="whitespace-pre-line">{state.card}</p>}
        {!summary && !state?.card && <p className="text-muted-foreground">No Summary Yet</p>}
        {when && <span className="text-xs text-muted-foreground">{when}</span>}
      </div>
    </Card>
  );
}
