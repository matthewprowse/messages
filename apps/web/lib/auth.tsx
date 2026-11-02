"use client";

// The signed-in session for the whole app: AuthProvider wraps the tree, useAuth reads it, and the owner check gates
// Analytics. The session is undefined until the stored one has been checked.

import { createContext, useContext, useEffect, useMemo, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "./supabase";
import { clearSignedUrls } from "./signed-urls";
import { needsSecondFactor } from "./mfa";

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
    supabase.auth.getSession().then(({ data }) => { if (latest === 0) void settle(data.session); });
    const { data } = supabase.auth.onAuthStateChange((_event, next) => {
      if (!next) clearSignedUrls(); // also when the session ends elsewhere (another tab, an expired refresh)
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

export async function signOut() {
  clearSignedUrls();
  await supabase.auth.signOut();
}
