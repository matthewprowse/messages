"use client";

// Admin view of team workspaces: seats, owner and member counts, and making an owner's invite. Nothing is emailed from here;
// the invite link is shown once for the admin to send themselves.

import { useCallback, useEffect, useState } from "react";
import { Check, Copy, Users } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/lib/supabase";
import { inviteLink } from "@/lib/team";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/primitives";
import { AdminHeading, AdminRow } from "@/components/admin/parts";

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
      <DialogContent showCloseButton={false} track="owner_invite" className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{shown?.name} Is Ready</DialogTitle>
          <DialogDescription>
            Send this link to {shown?.email}. It works once, only for that email address, and expires in 7 days. It is shown only now; New Invite Link under Teams makes another.
          </DialogDescription>
        </DialogHeader>
        <div className="flex items-center gap-2">
          <Input readOnly value={shown?.link ?? ""} aria-label="Invite Link" onFocus={(e) => e.currentTarget.select()} />
          <Button type="button" variant="ghost" size="icon" aria-label={copied ? "Copied" : "Copy Link"} onClick={copy}>{copied ? <Check /> : <Copy />}</Button>
        </div>
        <DialogFooter>
          <Button type="button" variant="secondary" onClick={onClose}>Done</Button>
        </DialogFooter>
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
    <AdminRow
      icon={<Users />}
      title={<>{team.name}{team.owner_email ? null : <Badge variant="outline">Owner Not Joined</Badge>}{team.strict_sharing && <Badge variant="secondary">Strict Sharing</Badge>}</>}
      description={`${team.members} of ${team.seats} seats in use. ${team.owner_email ? `Owner: ${team.owner_email}` : `Invited: ${team.invited_email ?? "nobody"}`}`}
    >
      {!team.owner_email && team.invited_email && <Button variant="ghost" disabled={busy} onClick={() => void reissue()}>New Invite Link</Button>}
      <Input aria-label={`Seats for ${team.name}`} inputMode="numeric" className="w-16 text-right" value={seats} onChange={(e) => setSeats(e.target.value)} />
      <Button variant="secondary" disabled={busy || !valid || next === team.seats} onClick={() => void save()}>Save</Button>
    </AdminRow>
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

  return (
    <div className="flex flex-col gap-3">
      <AdminHeading
        title="Teams"
        description="Approving a team request makes its team and an invite link for its owner. Seats are what the team pays for: at least 5, shared for storage and the AI allowance. Change them here until billing is built."
      />
      {failed ? (
        <EmptyState icon={Users} title="Could Not Load Teams" description="Check your connection and refresh." />
      ) : teams === null ? (
        <Skeleton className="h-24 w-full rounded-lg" />
      ) : teams.length === 0 ? (
        <div className="py-12"><EmptyState icon={Users} title="No Teams Yet" description="Approve a team request in the waitlist to make one." /></div>
      ) : (
        <div>
          {teams.map((t, i) => (
            <div key={`${t.id}:${t.seats}`}>
              {i > 0 && <Separator className="ml-3" />}
              <TeamRow team={t} onChanged={() => void load()} onInvite={onInvite} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
