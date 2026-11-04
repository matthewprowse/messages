"use client";

// Loads and saves the reply box's per-account settings (account_composer): signatures and the default send-from. Sealed in
// the browser with the user's key. The settings sit in a module-level cache so the reply box, New Email and Settings all
// see a save at once. The field is reused from the writing text (FIELD.writingBody): the AI worker never opens it.
// The reply box and the reply header mount together: they share one read (lib/memory-cache.ts), done again on a new
// sign-in or when a mount finds it older than COMPOSER_FRESH_MS.

import { useCallback, useEffect, useSyncExternalStore } from "react";
import { FIELD } from "@messages/crypto/fields";
import { supabase } from "./supabase";
import { useAuth } from "./auth";
import { open, seal } from "./vault";
import { EMPTY_COMPOSER, hasAnySignature, parseComposer, serializeComposer, type AccountComposer } from "./composer-settings";
import { createMemoryCache } from "./memory-cache";

/** Settings are changed here or in Settings, rarely elsewhere: a mount reads again only when the copy is older than this. */
const COMPOSER_FRESH_MS = 10 * 60_000;
type Settings = Record<string, AccountComposer>;
const NONE: Settings = {};
// By user id. Signatures are opened here: memory only, emptied on sign out.
const settings = createMemoryCache<Settings>({ max: 1 });

async function load(): Promise<Settings> {
  const { data, error } = await supabase.from("account_composer").select("account_id, settings");
  if (error) throw new Error(`Load composer settings failed (${error.code})`);
  const next: Settings = {};
  for (const r of data ?? []) next[r.account_id] = parseComposer(await open(FIELD.writingBody, r.settings));
  return next;
}

/** Every account's reply box settings, by account id. An account with none has no entry. */
export function useAccountComposer() {
  const { session } = useAuth();
  const userId = session?.user.id ?? null;
  const all = useSyncExternalStore(settings.subscribe, () => (userId ? settings.get(userId) : undefined) ?? NONE, () => NONE);
  useEffect(() => {
    if (userId) settings.load(userId, load, COMPOSER_FRESH_MS).catch(() => {});
  }, [userId]);

  /** Saves one account's settings. Shown at once; put back and false when the save fails. */
  const save = useCallback(async (accountId: string, next: AccountComposer): Promise<boolean> => {
    if (!userId) return false;
    const before = settings.get(userId)?.[accountId];
    settings.set(userId, { ...(settings.get(userId) ?? NONE), [accountId]: next });
    try {
      const { error } = await supabase.from("account_composer").upsert(
        { account_id: accountId, user_id: userId, settings: await seal(FIELD.writingBody, serializeComposer(next)), has_signature: hasAnySignature(next), updated_at: new Date().toISOString() },
        { onConflict: "account_id" },
      );
      if (error) throw error;
      return true;
    } catch {
      const { [accountId]: _lost, ...rest } = settings.get(userId) ?? NONE;
      settings.set(userId, before ? { ...rest, [accountId]: before } : rest);
      return false;
    }
  }, [userId]);

  return { all, of: (accountId: string | undefined) => (accountId ? all[accountId] : undefined) ?? EMPTY_COMPOSER, save };
}
