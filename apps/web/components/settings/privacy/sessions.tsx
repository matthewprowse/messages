"use client";

// Settings, Profile: Active Sessions and Sign Out Everywhere. The list comes from list_my_sessions (the Auth API
// has no list call), showing only a browser label and when each was last used. Sign Out Everywhere is Supabase's global sign
// out: every refresh token for the account stops working, this device included.

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/lib/supabase";
import { relTime } from "@/lib/format";
import { sessionLabel } from "@/lib/session-label";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { DIALOG_BUTTONS } from "@/components/merge-dialog";
import { SettingsRow, SettingsRows, SettingsSection } from "@/components/settings/primitives";

interface SessionRow { id: string; created_at: string; refreshed_at: string | null; user_agent: string | null; current: boolean }

export function SessionsSection() {
  const [sessions, setSessions] = useState<SessionRow[] | null>(null); // null until loaded, or when the list is not available
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    // The list is a nicety: if the function is not there yet or fails, Sign Out Everywhere still works.
    supabase.rpc("list_my_sessions").then(({ data, error }) => { if (!cancelled && !error) setSessions(data); });
    return () => { cancelled = true; };
  }, []);

  async function signOutEverywhere() {
    setBusy(true);
    const { error } = await supabase.auth.signOut({ scope: "global" });
    setBusy(false);
    setAsking(false);
    if (error) toast.error("Could not sign you out everywhere. Try again.");
  }

  return (
    <SettingsSection id="sessions" title="Active Sessions">
      <SettingsRows>
        {sessions?.map((s) => (
          <SettingsRow
            key={s.id}
            title={<>{sessionLabel(s.user_agent)} {s.current && <Badge variant="secondary">This Device</Badge>}</>}
            description={`Last active ${relTime(s.refreshed_at ?? s.created_at)}`}
          />
        ))}
        <SettingsRow title="Sign Out Everywhere">
          <Button variant="secondary" onClick={() => setAsking(true)}>Sign Out Everywhere</Button>
        </SettingsRow>
      </SettingsRows>

      <AlertDialog open={asking} onOpenChange={(o) => { if (!busy) setAsking(o); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Sign Out Everywhere?</AlertDialogTitle>
            <AlertDialogDescription>Every device and browser signed in to your account is signed out, this one too.</AlertDialogDescription>
          </AlertDialogHeader>
          <div className={DIALOG_BUTTONS}>
            <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
            <AlertDialogAction disabled={busy} onClick={(e) => { e.preventDefault(); void signOutEverywhere(); }}>Sign Out Everywhere</AlertDialogAction>
          </div>
        </AlertDialogContent>
      </AlertDialog>
    </SettingsSection>
  );
}
