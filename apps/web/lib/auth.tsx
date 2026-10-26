"use client";

import { createContext, useContext, useEffect, useMemo, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "./supabase";

interface AuthState {
  /** undefined while the stored session is being checked, null when signed out. */
  session: Session | null | undefined;
}

const AuthContext = createContext<AuthState>({ session: undefined });

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null | undefined>(undefined);

  useEffect(() => {
    // Only fills the first value: an auth event that lands first is newer and wins.
    supabase.auth.getSession().then(({ data }) => setSession((s) => (s === undefined ? data.session : s)));
    const { data } = supabase.auth.onAuthStateChange((_event, next) => setSession(next));
    return () => data.subscription.unsubscribe();
  }, []);

  const value = useMemo(() => ({ session }), [session]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  return useContext(AuthContext);
}

/** The one account that sees Analytics. The page's data is locked to it in the database too, once there is any. */
export const OWNER_EMAIL = "mattprowse03@gmail.com";

export function useIsOwner() {
  const { session } = useAuth();
  return session?.user.email?.toLowerCase() === OWNER_EMAIL;
}

export async function signOut() {
  await supabase.auth.signOut();
}
