"use client";

// The client card on a contact's page: one AI paragraph on where things stand with them, with a Refresh button
// that is capped per day. The worker writes the card; Refresh only asks, so the new text appears a little later.

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Section } from "@/components/contact-list";
import { loadClientCard, requestCardRefresh, type ClientCardState } from "@/lib/prep";
import { timeAgo } from "./time-ago";

const POLL_MS = 10_000;
const POLLS = 12; // two minutes of looking for the new card, then it shows when the page is next opened

export function ClientCard({ contactId }: { contactId: string }) {
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

  if (!state) return null;
  const busy = asking || state.pending;
  return (
    <Section title="Client Card">
      <div className="flex flex-col gap-3 rounded-lg border p-4">
        <p className="text-sm leading-6 whitespace-pre-line">{state.card ?? "No summary yet. It is written from your conversations and meetings with them."}</p>
        <div className="flex items-center justify-between gap-3">
          <span className="text-xs text-muted-foreground">{state.pending ? "Refreshing" : state.updatedAt && state.card ? `Updated ${timeAgo(state.updatedAt)}` : ""}</span>
          <Button variant="secondary" size="sm" onClick={refresh} disabled={busy || state.left === 0}>
            {state.left === 0 ? "Refreshed Today" : "Refresh"}
          </Button>
        </div>
      </div>
    </Section>
  );
}
