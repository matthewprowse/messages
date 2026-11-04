"use client";

// Admin's Teams view, the teams card: each team's seats (at least 5, what the team pays for, shared for storage and the AI
// allowance; set by hand until billing exists), owner and member counts, and a new owner's invite. Nothing is emailed from
// here; the invite link is shown once for the admin to send themselves.

import { useCallback, useEffect, useState } from "react";
import { Check, Copy, Link2, Users } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/lib/supabase";
import { inviteLink } from "@/lib/team";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { DIALOG_BUTTONS } from "@/components/merge-dialog";
import { Card, IconCircle, Row, Separated } from "@/components/surface";
import { IconAction } from "@/components/tip";
import { Failed, LoadingCard, Quiet } from "./parts";

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
      <DialogContent track="owner_invite" showCloseButton={false} className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{shown?.name} Is Ready</DialogTitle>
          {/* What the link does is the one thing to know before sending it, so it stays. */}
          <DialogDescription>For {shown?.email} only. It works once, expires in 7 days and is shown only now.</DialogDescription>
        </DialogHeader>
        <div className="flex items-center gap-2">
          <Input readOnly value={shown?.link ?? ""} aria-label="Invite Link" onFocus={(e) => e.currentTarget.select()} />
          <Button type="button" variant="ghost" size="icon" aria-label={copied ? "Copied" : "Copy Link"} onClick={copy}>{copied ? <Check /> : <Copy />}</Button>
        </div>
        <div className={DIALOG_BUTTONS}>
          <Button type="button" variant="secondary" onClick={onClose}>Done</Button>
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
    <Row
      lead={<IconCircle icon={Users} />}
      title={<>{team.name}{team.owner_email ? null : <Badge variant="outline" className="ml-2">Owner Not Joined</Badge>}{team.strict_sharing && <Badge variant="secondary" className="ml-2">Strict Sharing</Badge>}</>}
      detail={`${team.members} Of ${team.seats} Seats. ${team.owner_email ? `Owner ${team.owner_email}` : `Invited ${team.invited_email ?? "Nobody"}`}`}
      end={
        <>
          {!team.owner_email && team.invited_email && <IconAction label="New Invite Link" icon={Link2} disabled={busy} onClick={() => void reissue()} />}
          <Input aria-label={`Seats for ${team.name}`} inputMode="numeric" className="h-8 w-16 text-right" value={seats} onChange={(e) => setSeats(e.target.value)} />
          <Button variant="secondary" disabled={busy || !valid || next === team.seats} onClick={() => void save()}>Save</Button>
        </>
      }
    />
  );
}

/** Every team and its seats, for the owner. Seats are at least 5 and can be set by hand until billing exists. */
export function Workspaces({ version, onInvite, onBusy }: { version: number; onInvite: (invite: OwnerInvite) => void; onBusy: (busy: boolean) => void }) {
  const [teams, setTeams] = useState<Team[] | null>(null);
  const [failed, setFailed] = useState(false);

  const load = useCallback(async () => {
    onBusy(true);
    setFailed(false);
    const { data, error } = await supabase.rpc("admin_workspaces");
    if (error) setFailed(true);
    else setTeams(data as Team[]);
    onBusy(false);
  }, [onBusy]);
  useEffect(() => { void load(); }, [load, version]);

  if (failed) return <Failed title="Could Not Load Teams" />;
  if (teams === null) return <LoadingCard title="Teams" />;
  return (
    <Card title="Teams">
      {teams.length === 0 ? <Quiet>No Teams Yet</Quiet> : (
        <Separated>
          {teams.map((t) => <TeamRow key={`${t.id}:${t.seats}`} team={t} onChanged={() => void load()} onInvite={onInvite} />)}
        </Separated>
      )}
    </Card>
  );
}
