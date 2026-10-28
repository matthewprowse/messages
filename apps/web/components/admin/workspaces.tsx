"use client";

import { useCallback, useEffect, useState } from "react";
import { Check, Copy, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/lib/supabase";
import { inviteLink } from "@/lib/team";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { DIALOG_BUTTONS } from "@/components/merge-dialog";
import { SettingsEmpty, SettingsRow, SettingsRows, SettingsSection } from "@/components/settings/sections";

type Team = { id: string; name: string; seats: number; strict_sharing: boolean; owner_email: string | null; invited_email: string | null; members: number };

/** An invite for a team's owner, with the link to send them. Nothing is emailed from here. */
export type OwnerInvite = { name: string; email: string; link: string };

/** Shows an owner's invite link once, as it is made. */
export function OwnerInviteDialog({ invite, onClose }: { invite: OwnerInvite | null; onClose: () => void }) {
  const [copied, setCopied] = useState(false);
  // What was last shown stays in the dialog while it fades out.
  const [last, setLast] = useState(invite);
  if (invite && invite !== last) setLast(invite);
  const shown = invite ?? last;

  const copy = async () => {
    if (!shown) return;
    try {
      await navigator.clipboard.writeText(shown.link);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast("Could not copy. Select the link and copy it by hand.");
    }
  };

  return (
    <Dialog open={!!invite} onOpenChange={(open) => !open && onClose()}>
      <DialogContent track="owner_invite" className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{shown?.name} Is Ready</DialogTitle>
          <DialogDescription>
            Send this link to {shown?.email}. It works once, only for that email address, and expires in 7 days. It is shown only now; New Invite Link under Teams makes another.
          </DialogDescription>
        </DialogHeader>
        <div className="flex items-center gap-2">
          <Input readOnly value={shown?.link ?? ""} aria-label="Invite Link" onFocus={(e) => e.currentTarget.select()} />
          <Button type="button" variant="outline" size="icon" aria-label={copied ? "Copied" : "Copy Link"} onClick={copy}>{copied ? <Check /> : <Copy />}</Button>
        </div>
        <div className={DIALOG_BUTTONS}>
          <Button type="button" onClick={onClose}>Done</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function TeamRow({ team, onChanged, onInvite }: { team: Team; onChanged: () => void; onInvite: (invite: OwnerInvite) => void }) {
  const [seats, setSeats] = useState(String(team.seats));
  const [busy, setBusy] = useState(false);
  const next = Number(seats);
  const valid = Number.isInteger(next) && next >= 5;

  const save = async () => {
    setBusy(true);
    const { error } = await supabase.rpc("set_seats", { p_workspace: team.id, p_seats: next });
    setBusy(false);
    if (error) return void toast.error(error.message || "Could Not Change the Seats");
    toast(`${team.name} Now Has ${next} Seats`);
    onChanged();
  };

  const reissue = async () => {
    setBusy(true);
    const { data, error } = await supabase.rpc("reissue_owner_invite", { p_workspace: team.id });
    setBusy(false);
    if (error || !data) return void toast.error(error?.message || "Could Not Make an Invite Link");
    onInvite({ name: team.name, email: team.invited_email ?? "", link: inviteLink(data) });
  };

  return (
    <SettingsRow
      title={<>{team.name}{team.owner_email ? null : <Badge variant="outline">Owner Not Joined</Badge>}{team.strict_sharing && <Badge variant="secondary">Strict Sharing</Badge>}</>}
      description={`${team.members} of ${team.seats} seats in use. ${team.owner_email ? `Owner: ${team.owner_email}` : `Invited: ${team.invited_email ?? "nobody"}`}`}
    >
      {!team.owner_email && team.invited_email && <Button size="sm" variant="outline" disabled={busy} onClick={() => void reissue()}>New Invite Link</Button>}
      <Input aria-label={`Seats for ${team.name}`} inputMode="numeric" className="w-16 text-right" value={seats} onChange={(e) => setSeats(e.target.value)} />
      <Button size="sm" disabled={busy || !valid || next === team.seats} onClick={() => void save()}>Save</Button>
    </SettingsRow>
  );
}

/** Every team and its seats, for the owner. Seats are at least 5 and can be set by hand until billing exists. */
export function Workspaces({ version, onInvite }: { version: number; onInvite: (invite: OwnerInvite) => void }) {
  const [teams, setTeams] = useState<Team[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setBusy(true);
    setFailed(false);
    const { data, error } = await supabase.rpc("admin_workspaces");
    if (error) setFailed(true);
    else setTeams(data as Team[]);
    setBusy(false);
  }, []);
  useEffect(() => { void load(); }, [load, version]);

  return (
    <SettingsSection
      title="Teams"
      description="Approving a team request makes its team and an invite link for its owner. Seats are what the team pays for: at least 5, shared for storage and the AI allowance. Change them here until billing is built."
    >
      <div className="flex justify-end">
        <Button variant="outline" size="icon" aria-label="Refresh Teams" disabled={busy} onClick={() => void load()}><RefreshCw className={busy ? "animate-spin" : undefined} /></Button>
      </div>
      {failed ? (
        <p className="text-sm text-muted-foreground">Could not load. Check your connection and refresh.</p>
      ) : teams === null ? (
        <Skeleton className="h-24 w-full rounded-lg" />
      ) : teams.length === 0 ? (
        <SettingsEmpty>No teams yet. Approve a team request above to make one.</SettingsEmpty>
      ) : (
        <SettingsRows>
          {teams.map((t) => <TeamRow key={`${t.id}:${t.seats}`} team={t} onChanged={() => void load()} onInvite={onInvite} />)}
        </SettingsRows>
      )}
    </SettingsSection>
  );
}
