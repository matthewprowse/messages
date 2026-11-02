"use client";

// Subscriptions grouped by company with their own selection and unsubscribe actions. Grouping is in lib/subscription-senders.ts.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { track } from "@/lib/analytics";
import { useApp } from "@/lib/store";
import type { Contact, Thread } from "@/lib/types";
import { toggleSelection } from "@/lib/selection";
import { canPick, groupSenders } from "@/lib/subscription-senders";

/**
 * Subscriptions grouped by company, so a whole company (every address it writes from) can be picked and
 * unsubscribed from in one go. The list keeps the checked rows so its header can act on them. The selection
 * clears when `reset` changes.
 */
export function useSubscriptions(items: Thread[], contactOf: (id: string) => Contact | undefined, reset: string) {
  const { unsubscribes, unsubscribe, confirmUnsubscribe } = useApp();
  const [checked, setChecked] = useState<string[]>([]);
  const anchor = useRef<string | null>(null);


  const senders = useMemo(() => groupSenders(items, contactOf), [items, contactOf]);

  // Keyed like an address, so each row finds its addresses' states without scanning.
  const statusByKey = useMemo(() => new Map(unsubscribes.map((u) => [`${u.accountId}:${u.sender}`, u])), [unsubscribes]);
  // A row can be picked while any of its addresses can still be unsubscribed from.
  const pickable = useMemo(
    () => senders.filter((s) => s.addresses.some((a) => canPick(statusByKey.get(a.key)))).map((s) => s.key),
    [senders, statusByKey],
  );
  // A sender that starts unsubscribing drops out of the selection.
  const picked = useMemo(() => { const ok = new Set(pickable); return checked.filter((k) => ok.has(k)); }, [checked, pickable]);

  useEffect(() => { setChecked([]); anchor.current = null; }, [reset]);

  const check = useCallback((key: string, range: boolean) => {
    const from = anchor.current;
    setChecked((c) => toggleSelection(pickable, c, key, from, range));
    anchor.current = key;
  }, [pickable]);

  // Every address in the chosen rows that can still be unsubscribed from.
  const run = useCallback(async (keys: string[]) => {
    const chosen = senders.filter((s) => keys.includes(s.key));
    const addresses = chosen.flatMap((s) => s.addresses.filter((a) => canPick(statusByKey.get(a.key))));
    if (addresses.length === 0) return;
    track("feature_used", { feature: "unsubscribe", detail: chosen.length > 1 ? "many" : "one" });
    await unsubscribe(addresses.map((a) => ({ accountId: a.accountId, sender: a.address })));
    setChecked((c) => c.filter((k) => !keys.includes(k)));
  }, [senders, statusByKey, unsubscribe]);

  return { senders, statusByKey, pickable, picked, setChecked, check, run, confirm: confirmUnsubscribe };
}
