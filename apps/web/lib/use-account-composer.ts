"use client";

// Loads and saves the reply box's per-account settings (account_composer): signatures and the default send-from. Sealed in
// the browser with the user's key. The settings sit in a module-level cache so the reply box, New Email and Settings all
// see a save at once. The field is reused from the writing text (FIELD.writingBody): the AI worker never opens it.

import { useCallback, useEffect, useSyncExternalStore } from "react";
import { FIELD } from "@messages/crypto/fields";
import { supabase } from "./supabase";
import { useAuth } from "./auth";
import { open, seal } from "./vault";
import { EMPTY_COMPOSER, hasAnySignature, parseComposer, serializeComposer, type AccountComposer } from "./composer-settings";

let cache: Record<string, AccountComposer> = {};
let loadedFor: string | null = null;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());
const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; };

async function load(userId: string) {
  const { data, error } = await supabase.from("account_composer").select("account_id, settings");
  if (error) return;
  const next: Record<string, AccountComposer> = {};
  for (const r of data ?? []) next[r.account_id] = parseComposer(await open(FIELD.writingBody, r.settings));
  cache = next;
  loadedFor = userId;
  emit();
}

/** Every account's reply box settings, by account id. An account with none has no entry. */
export function useAccountComposer() {
  const { session } = useAuth();
  const userId = session?.user.id ?? null;
  const all = useSyncExternalStore(subscribe, () => cache, () => cache);
  useEffect(() => {
    if (!userId) { cache = {}; loadedFor = null; emit(); return; }
    if (loadedFor !== userId) void load(userId);
  }, [userId]);

  /** Saves one account's settings. Shown at once; put back and false when the save fails. */
  const save = useCallback(async (accountId: string, next: AccountComposer): Promise<boolean> => {
    if (!userId) return false;
    const before = cache[accountId];
    cache = { ...cache, [accountId]: next };
    emit();
    try {
      const { error } = await supabase.from("account_composer").upsert(
        { account_id: accountId, user_id: userId, settings: await seal(FIELD.writingBody, serializeComposer(next)), has_signature: hasAnySignature(next), updated_at: new Date().toISOString() },
        { onConflict: "account_id" },
      );
      if (error) throw error;
      return true;
    } catch {
      const { [accountId]: _lost, ...rest } = cache;
      cache = before ? { ...rest, [accountId]: before } : rest;
      emit();
      return false;
    }
  }, [userId]);

  return { all, of: (accountId: string | undefined) => (accountId ? all[accountId] : undefined) ?? EMPTY_COMPOSER, save };
}
