"use client";

import { useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/auth";
import { ROLE_LABEL, useTeam } from "@/lib/team";
import { refreshMyTeam } from "@/lib/share";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { DIALOG_BUTTONS } from "@/components/merge-dialog";
import { SettingsHeader } from "@/components/settings-header";
import { SettingsEmpty, SettingsRow, SettingsRows, SettingsSection } from "@/components/settings/sections";
import { MembersSection } from "@/components/settings/team-members";
import { SharedChatsSection } from "@/components/settings/team-shared";
import { TeamOwnerSection } from "@/components/settings/team-owner";
import { TeamAfterSection } from "@/components/settings/team-after";

export default function TeamPage() {
  const { session } = useAuth();
  const { state, failed, load } = useTeam();
  const [busy, setBusy] = useState(false);
  const [confirmOff, setConfirmOff] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const userId = session?.user.id;

  const setStrict = async (strict: boolean) => {
    setBusy(true);
    const { error } = await supabase.rpc("set_strict_sharing", { p_strict: strict });
    setBusy(false);
    if (error) return void toast.error(error.message || "Could not change this. Try again.");
    setConfirmOff(false);
    toast(strict ? "Strict sharing is on" : "Strict sharing is off");
    refreshMyTeam(); // the Work and Personal badges and Move to Personal follow it
    void load();
  };

  const leave = async () => {
    if (!userId) return;
    setBusy(true);
    const { error } = await supabase.rpc("remove_member", { p_user: userId });
    setBusy(false);
    if (error) return void toast.error(error.message || "Could not leave the team. Try again.");
    setLeaving(false);
    toast("You left the team");
    void load();
  };

  const workspace = state?.workspace ?? null;
  const manages = state?.role === "owner" || state?.role === "admin";
  const hasCompliance = !!state?.people.some((p) => p.role === "compliance" && p.status !== "removed");

  return (
    <>
      <SettingsHeader title="Team" description={workspace ? workspace.name : "People you work with, and what the team can see."} />
      <div className="space-y-8">
        {failed && (
          <Alert variant="destructive">
            <AlertTitle>Could Not Load Your Team</AlertTitle>
            <AlertDescription>
              <p>Check your connection and try again.</p>
              <Button variant="outline" size="sm" className="mt-2" onClick={() => void load()}>Retry</Button>
            </AlertDescription>
          </Alert>
        )}
        {!state ? (
          failed ? null : <Skeleton className="h-40 w-full rounded-lg" />
        ) : !workspace || !userId ? (
          <SettingsSection id="team" title="No Team Yet" description="A team is set up for a business, and its owner invites each person. If you have been invited, open the invite link you were sent to join.">
            <SettingsEmpty>Nothing is shared with anyone. Your mail and chats are private to you.</SettingsEmpty>
          </SettingsSection>
        ) : (
          <>
            <MembersSection team={state} userId={userId} onChanged={() => void load()} />

            <SettingsSection id="sharing" title="Sharing" description="Only chats marked as work are shared with the team. Everything else stays private to each person.">
              <SettingsRows>
                <SettingsRow
                  title={<>Strict Sharing{state.role !== "owner" && <Badge variant="secondary">{workspace.strictSharing ? "On" : "Off"}</Badge>}</>}
                  description="Keeps work chats shared until the owner releases them, so a person cannot move one back to personal. It also turns on the Compliance role, for someone who supervises client communication in a regulated firm. Compliance can read every work chat in the team, never a personal one. People are told before they join. Only the owner can change this or give the Compliance role."
                >
                  {state.role === "owner" && <Switch checked={workspace.strictSharing} disabled={busy} aria-label="Strict Sharing" onCheckedChange={(on) => (on ? void setStrict(true) : hasCompliance ? setConfirmOff(true) : void setStrict(false))} />}
                </SettingsRow>
              </SettingsRows>
            </SettingsSection>

            <SharedChatsSection strict={workspace.strictSharing} role={state.role} />

            <TeamOwnerSection team={state} />

            <TeamAfterSection team={state} userId={userId} />

            {state.role !== "owner" && (
              <SettingsSection id="membership" title="Your Membership" description={`You are ${state.role ? ROLE_LABEL[state.role] : "a member"} of ${workspace.name}. Leaving ends your access to what the team shares. Your own mail and chats stay with you.`}>
                <Button variant="outline" size="sm" disabled={busy} onClick={() => setLeaving(true)}>Leave Team</Button>
              </SettingsSection>
            )}
          </>
        )}
      </div>

      <AlertDialog open={confirmOff} onOpenChange={(open) => !busy && setConfirmOff(open)}>
        <AlertDialogContent track="strict_sharing_off">
          <AlertDialogHeader>
            <AlertDialogTitle>Turn Off Strict Sharing?</AlertDialogTitle>
            <AlertDialogDescription>
              The Compliance role ends with it. Anyone who is Compliance becomes a Member and can no longer read the team&apos;s work chats.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className={DIALOG_BUTTONS}>
            <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
            <AlertDialogAction variant="destructive" disabled={busy} onClick={(e) => { e.preventDefault(); void setStrict(false); }}>{busy ? "Turning Off" : "Turn Off"}</AlertDialogAction>
          </div>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={leaving} onOpenChange={(open) => !busy && setLeaving(open)}>
        <AlertDialogContent track="leave_team">
          <AlertDialogHeader>
            <AlertDialogTitle>Leave {workspace?.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              You lose access to anything the team shares. Your own mail and chats stay with you, and nothing of yours is deleted. To join again, the owner must invite you.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className={DIALOG_BUTTONS}>
            <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
            <AlertDialogAction variant="destructive" disabled={busy} onClick={(e) => { e.preventDefault(); void leave(); }}>{busy ? "Leaving" : "Leave Team"}</AlertDialogAction>
          </div>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
