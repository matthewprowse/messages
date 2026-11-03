"use client";

// Settings, Team: the workspace and its people, loaded with useTeam, with Retry when the load fails. The team's longer lists
// are views in the pane (?view=work-chats, activity, voice, exports), each shown only to the roles that may see it.

import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/auth";
import { ROLE_LABEL, useTeam, type TeamState } from "@/lib/team";
import { refreshMyTeam } from "@/lib/share";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { DIALOG_BUTTONS } from "@/components/merge-dialog";
import { ViewButtons } from "@/components/pane";
import { SettingsEmpty, SettingsRow, SettingsRows, SettingsSection } from "@/components/settings/primitives";
import { SettingsPage } from "@/components/settings/settings-page";
import { MembersSection } from "@/components/settings/team-members";
import { SharedChatsSection } from "@/components/settings/team-shared";
import { SharedInboxesSection } from "@/components/settings/team-inboxes";
import { CoverSection } from "@/components/settings/team-cover";
import { WorkChatsSection } from "@/components/settings/team-work";
import { TeamActivity } from "@/components/settings/team-activity";
import { CompanyVoiceSections } from "@/components/settings/team-voice";
import { ExportLogSection } from "@/components/settings/team-exports";

type View = "team" | "work-chats" | "activity" | "voice" | "exports";

/** The views this person's role may open, in order. Compliance sees work chats and exports only while strict sharing is on. */
function viewsFor(team: TeamState): { key: View; label: string }[] {
  const manages = team.role === "owner" || team.role === "admin";
  const oversees = manages || (team.role === "compliance" && !!team.workspace?.strictSharing);
  return [
    { key: "team" as const, label: "Team" },
    ...(oversees ? [{ key: "work-chats" as const, label: "Work Chats" }] : []),
    ...(manages ? [{ key: "activity" as const, label: "Activity" }] : []),
    { key: "voice" as const, label: "Company Voice" },
    ...(oversees ? [{ key: "exports" as const, label: "Exports" }] : []),
  ];
}

export default function TeamPage() {
  return (
    <SettingsPage title="Team">
      <Suspense fallback={null}><Team /></Suspense>
    </SettingsPage>
  );
}

function Team() {
  const { session } = useAuth();
  const { state, failed, load } = useTeam();
  const params = useSearchParams();
  const userId = session?.user.id;

  if (failed) {
    return (
      <Alert variant="destructive">
        <AlertTitle>Could Not Load Your Team</AlertTitle>
        <AlertDescription>
          <p>Check your connection and try again.</p>
          <Button variant="secondary" className="mt-2" onClick={() => void load()}>Retry</Button>
        </AlertDescription>
      </Alert>
    );
  }
  if (!state || !userId) return <Skeleton className="h-40 w-full rounded-lg" />;
  if (!state.workspace) {
    return (
      <SettingsSection id="team" title="No Team Yet">
        <SettingsEmpty>Teams are set up for a business by Konva. If you have been invited, open the invite link you were sent.</SettingsEmpty>
      </SettingsSection>
    );
  }
  const views = viewsFor(state);
  // An address for a view this role cannot open (an old link, a changed role) shows the team instead.
  const asked = params.get("view");
  const view = views.find((v) => v.key === asked)?.key ?? "team";
  return (
    <>
      <div className="flex h-10 items-center">
        <ViewButtons label="Team" items={views} value={view} hrefFor={(key) => (key === "team" ? "/settings/team" : `/settings/team?view=${key}`)} />
      </div>
      {view === "work-chats" ? <WorkChatsSection team={state} userId={userId} />
        : view === "activity" ? <TeamActivity />
        : view === "voice" ? <CompanyVoiceSections team={state} />
        : view === "exports" ? <ExportLogSection />
        : <Overview team={state} userId={userId} load={load} />}
    </>
  );
}

/** The team view: members, strict sharing, what you share, shared inboxes, cover and, for anyone but the owner, leaving. */
function Overview({ team, userId, load }: { team: TeamState; userId: string; load: () => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  const [confirmOff, setConfirmOff] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const workspace = team.workspace;
  if (!workspace) return null;
  const hasCompliance = team.people.some((p) => p.role === "compliance" && p.status !== "removed");

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
    setBusy(true);
    const { error } = await supabase.rpc("remove_member", { p_user: userId });
    setBusy(false);
    if (error) return void toast.error(error.message || "Could not leave the team. Try again.");
    setLeaving(false);
    toast("You left the team");
    void load();
  };

  return (
    <>
      <MembersSection team={team} userId={userId} onChanged={() => void load()} />

      <SettingsSection id="sharing" title="Sharing">
        <SettingsRows>
          <SettingsRow title={<>Strict Sharing{team.role !== "owner" && <Badge variant="secondary">{workspace.strictSharing ? "On" : "Off"}</Badge>}</>}>
            {team.role === "owner" && <Switch checked={workspace.strictSharing} disabled={busy} aria-label="Strict Sharing" onCheckedChange={(on) => (on ? void setStrict(true) : hasCompliance ? setConfirmOff(true) : void setStrict(false))} />}
          </SettingsRow>
        </SettingsRows>
      </SettingsSection>

      <SharedChatsSection strict={workspace.strictSharing} role={team.role} />
      <SharedInboxesSection team={team} />
      <CoverSection team={team} userId={userId} />

      {team.role !== "owner" && (
        <SettingsSection id="membership" title="Your Membership">
          <SettingsRows>
            <SettingsRow title={workspace.name} description={team.role ? ROLE_LABEL[team.role] : "Member"}>
              <Button variant="ghost" className="text-destructive hover:text-destructive" disabled={busy} onClick={() => setLeaving(true)}>Leave Team</Button>
            </SettingsRow>
          </SettingsRows>
        </SettingsSection>
      )}

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
            <AlertDialogAction variant="ghost" className="text-destructive hover:text-destructive" disabled={busy} onClick={(e) => { e.preventDefault(); void setStrict(false); }}>{busy ? "Turning Off" : "Turn Off"}</AlertDialogAction>
          </div>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={leaving} onOpenChange={(open) => !busy && setLeaving(open)}>
        <AlertDialogContent track="leave_team">
          <AlertDialogHeader>
            <AlertDialogTitle>Leave {workspace.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              You lose access to anything the team shares. Your own mail and chats stay with you, and nothing of yours is deleted. To join again, the owner must invite you.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className={DIALOG_BUTTONS}>
            <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
            <AlertDialogAction variant="ghost" className="text-destructive hover:text-destructive" disabled={busy} onClick={(e) => { e.preventDefault(); void leave(); }}>{busy ? "Leaving" : "Leave Team"}</AlertDialogAction>
          </div>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
