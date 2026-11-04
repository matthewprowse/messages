"use client";

// The signed-in session for the whole app: AuthProvider wraps the tree, useAuth reads it, and the owner check gates
// Analytics. The session is undefined until the stored one has been checked.

import { createContext, useContext, useEffect, useMemo, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "./supabase";
import { clearSignedUrls } from "./signed-urls";
import { clearMemoryCaches } from "./memory-cache";
import { clearSentTimes } from "./sent-times-cache";
import { clearLocalCopy } from "./local-copy/device-copy";
import { needsSecondFactor } from "./mfa";
import { clearCachedPages } from "./service-worker";

// What this browser holds of the last person once their session is gone, however it went (sign-out here or in another
// tab, an expired refresh, a page opened with no session): signed links, the screens' memory caches, the service
// worker's stored pages, the sealed inbox copy with its device key, and the search index, a cache of their text. Run from
// AuthProvider at app start, not from the search palette, so it happens even if that never loaded.
// The index code is imported on demand to keep it out of the first page load.
let forgetting: Promise<void> | null = null;
function forgetLocalData(): Promise<void> {
  clearSignedUrls();
  clearMemoryCaches();
  clearSentTimes();
  clearCachedPages();
  forgetting ??= Promise.all([
    clearLocalCopy().catch(() => undefined),
    import("./search/client").then((m) => m.forgetIndex()).catch(() => undefined),
  ]).then(() => undefined).finally(() => { forgetting = null; });
  return forgetting;
}

interface AuthState {
  /** undefined while the stored session is being checked, null when signed out. */
  session: Session | null | undefined;
  /** True while a password or email sign-in is waiting for its two-factor code. `session` stays null then, so the app holds back (and /api/keys would refuse an aal1 token anyway). */
  mfaRequired: boolean;
}

const AuthContext = createContext<AuthState>({ session: undefined, mfaRequired: false });

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  const [mfaRequired, setMfaRequired] = useState(false);

  useEffect(() => {
    let latest = 0;
    // A session whose user has a verified factor is not signed in until the code is entered (aal2). Checked on every
    // change; a slower check that lands after a newer one is dropped.
    const settle = async (next: Session | null) => {
      const mine = ++latest;
      let pending = false;
      if (next) {
        const { data } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
        pending = needsSecondFactor(data);
      }
      if (mine !== latest) return;
      setMfaRequired(pending);
      setSession(pending ? null : next);
    };
    supabase.auth.getSession().then(({ data }) => {
      if (!data.session) void forgetLocalData();
      if (latest === 0) void settle(data.session);
    });
    const { data } = supabase.auth.onAuthStateChange((_event, next) => {
      if (!next) void forgetLocalData();
      // Not awaited here: Supabase warns against calling its own methods inside this callback.
      setTimeout(() => void settle(next), 0);
    });
    return () => data.subscription.unsubscribe();
  }, []);

  const value = useMemo(() => ({ session, mfaRequired }), [session, mfaRequired]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  return useContext(AuthContext);
}

/** The one account that sees Analytics. The page's data is locked to it in the database too, once there is any. */
export const OWNER_EMAIL = "mattprowse03@gmail.com";

/** True when the signed-in email is OWNER_EMAIL. A UI gate only: the database enforces the real limit. */
export function useIsOwner() {
  const { session } = useAuth();
  return session?.user.email?.toLowerCase() === OWNER_EMAIL;
}

/**
 * Signs out and takes what this browser holds of the person with it: this device's push subscription, the team invite
 * waiting for a sign-in, and (through the auth listener above) the search index and cached links. `scope: "global"` ends
 * every session for the account, this one included. `keepInvite` is for the invite page, which signs out to accept the
 * invite as someone else. Resolves to Supabase's error when the sign-out failed (the session is then still here), or null.
 */
export async function signOut({ scope = "local", keepInvite = false }: { scope?: "local" | "global"; keepInvite?: boolean } = {}) {
  const { data } = await supabase.auth.getSession();
  // Imported on demand: both modules import this one for useAuth.
  const [{ dropPushSubscription }, { INVITE_KEY }] = await Promise.all([import("./use-push"), import("./team")]);
  // Before signing out: once the session is gone, row level security no longer lets this device delete its own row.
  await dropPushSubscription(data.session?.user.id);
  try {
    if (!keepInvite) localStorage.removeItem(INVITE_KEY);
  } catch { /* storage blocked */ }
  const { error } = await supabase.auth.signOut({ scope });
  if (error) return error;
  await forgetLocalData();
  return null;
}
