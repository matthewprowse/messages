// Unsubscribing from senders: queueing the request, and the delayed "I've Unsubscribed" confirmation.

import { useCallback } from "react";
import { toast } from "sonner";
import { addressIndex } from "@messages/crypto/addresses";
import { supabase } from "../supabase";
import { UNSUBSCRIBE_COLUMNS, mapUnsubscribe } from "../data";
import { userKeys } from "../vault";
import { sealAddress } from "../address-refs";
import type { Action, State } from "./reducer";

// "I've Unsubscribed" is easy to press by mistake, so it shows at once but is only saved once this long has
// passed without Undo. Closing the page in that time saves nothing, and the sender stays to do.
const CONFIRM_UNSUBSCRIBE_MS = 6000;

/** The unsubscribe actions of the context. */
export function useUnsubscribes({ rawDispatch, stateRef }: { rawDispatch: React.Dispatch<Action>; stateRef: React.MutableRefObject<State> }) {
  const unsubscribe = useCallback(async (senders: { accountId: string; sender: string }[]) => {
    const existing = new Map(stateRef.current.unsubscribes.map((u) => [`${u.accountId}|${u.sender}`, u]));
    // Senders are queued at once rather than one after another. Returns true when the sender is queued.
    const queueOne = async (s: { accountId: string; sender: string }) => {
      const previous = existing.get(`${s.accountId}|${s.sender}`);
      if (previous && previous.status !== "failed" && previous.status !== "manual") return true; // already on its way
      if (previous) {
        // A failed or manual attempt is cleared first so the sender can be tried again.
        await supabase.from("unsubscribes").delete().eq("id", previous.id);
        rawDispatch({ type: "removeUnsubscribe", id: previous.id });
      }
      // With the sender's index, which the database matches on (and which keeps a sender to one row).
      const stored = { sender_address: await sealAddress(s.sender), sender_index: await addressIndex(await userKeys(), s.sender) };
      const { data, error } = await supabase.from("unsubscribes").insert({ account_id: s.accountId, ...stored }).select(UNSUBSCRIBE_COLUMNS).single();
      if (error || !data) return false;
      rawDispatch({ type: "upsertUnsubscribe", unsubscribe: { ...mapUnsubscribe(data), sender: s.sender } });
      return true;
    };
    const results = await Promise.all(senders.map(queueOne));
    const queued = results.filter(Boolean).length;
    if (queued < senders.length) toast("Some senders could not be queued. Try again.");
    return queued;
  }, []);

  const confirmUnsubscribe = useCallback((id: string) => {
    const before = stateRef.current.unsubscribes.find((u) => u.id === id);
    if (!before || before.status !== "manual") return;
    rawDispatch({ type: "upsertUnsubscribe", unsubscribe: { ...before, status: "done" } });
    const timer = setTimeout(() => {
      void supabase.rpc("confirm_unsubscribe", { p_id: id }).then(({ error }) => {
        if (!error) return;
        rawDispatch({ type: "upsertUnsubscribe", unsubscribe: before });
        toast("Could not mark it as unsubscribed. Try again.");
      });
    }, CONFIRM_UNSUBSCRIBE_MS);
    toast("Marked as unsubscribed", {
      duration: CONFIRM_UNSUBSCRIBE_MS,
      action: { label: "Undo", onClick: () => { clearTimeout(timer); rawDispatch({ type: "upsertUnsubscribe", unsubscribe: before }); } },
    });
  }, []);

  return { unsubscribe, confirmUnsubscribe };
}
