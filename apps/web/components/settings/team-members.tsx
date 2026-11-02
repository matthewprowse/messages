"use client";

// Settings, Team, Members: the people, their role and status, and the invite and role controls for owners and admins.

import { useState } from "react";
import { Check, Copy, UserPlus } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/lib/supabase";
import { ROLE_HELP, ROLE_LABEL, assignableRoles, inviteLink, type TeamPerson, type TeamRole, type TeamState } from "@/lib/team";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DIALOG_BUTTONS } from "@/components/merge-dialog";
import { SettingsRow, SettingsRows, SettingsSection } from "@/components/settings/sections";

const day = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
const problem = (error: { message: string } | null) => error?.message || "Something went wrong. Try again.";

/** Makes an invite and shows its link once. Nothing is emailed: the owner or admin sends the link themselves. */
function InviteDialog({ open, strict, myRole, onClose, onInvited }: { open: boolean; strict: boolean; myRole: TeamRole | null; onClose: () => void; onInvited: () => void }) {
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<TeamRole>("member");
  const [busy, setBusy] = useState(false);
  const [link, setLink] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [sentTo, setSentTo] = useState("");

  const close = () => {
    onClose();
    // Cleared once it has faded out.
    setTimeout(() => { setEmail(""); setRole("member"); setLink(null); setCopied(false); }, 200);
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    const { data, error } = await supabase.rpc("invite_member", { p_email: email.trim(), p_role: role });
    setBusy(false);
    if (error || !data) return void toast.error(problem(error));
    setSentTo(email.trim().toLowerCase());
    setLink(inviteLink(data));
    onInvited();
  };

  const copy = async () => {
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast("Could not copy. Select the link and copy it by hand.");
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !next && close()}>
      <DialogContent showCloseButton={false} track="invite_member" className="sm:max-w-md">
        {link ? (
          <>
            <DialogHeader>
              <DialogTitle>Invite Link Ready</DialogTitle>
              <DialogDescription>
                Send this link to {sentTo}. It works once, only for that email address, and expires in 7 days. It is shown only now, so if you lose it, invite them again.
              </DialogDescription>
            </DialogHeader>
            <div className="flex items-center gap-2">
              <Input readOnly value={link} aria-label="Invite Link" onFocus={(e) => e.currentTarget.select()} />
              <Button type="button" variant="secondary" size="icon" aria-label={copied ? "Copied" : "Copy Link"} onClick={copy}>{copied ? <Check /> : <Copy />}</Button>
            </div>
            <div className={DIALOG_BUTTONS}>
              <Button variant="secondary" type="button" onClick={close}>Done</Button>
            </div>
          </>
        ) : (
          <form onSubmit={submit} className="space-y-3">
            <DialogHeader>
              <DialogTitle>Invite Person</DialogTitle>
              <DialogDescription>They get a link to join your team. Nothing is emailed from here.</DialogDescription>
            </DialogHeader>
            <div className="grid gap-2">
              <Label htmlFor="invite-email">Email</Label>
              <Input id="invite-email" type="email" autoComplete="off" autoFocus required value={email} onChange={(e) => setEmail(e.target.value)} />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="invite-role">Role</Label>
              <Select value={role} onValueChange={(v) => setRole(v as TeamRole)}>
                <SelectTrigger id="invite-role" className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {assignableRoles(myRole, strict).map((r) => <SelectItem key={r} value={r}>{ROLE_LABEL[r]}</SelectItem>)}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">{ROLE_HELP[role]}</p>
            </div>
            <div className={DIALOG_BUTTONS}>
              <Button type="button" variant="ghost" disabled={busy} onClick={close}>Cancel</Button>
              <Button variant="secondary" type="submit" disabled={busy || !email.trim()}>{busy ? "Creating Link" : "Create Invite Link"}</Button>
            </div>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

/** The team's people with their role and status, and for an owner or admin the controls to change them. */
export function MembersSection({ team, userId, onChanged }: { team: TeamState; userId: string; onChanged: () => void }) {
  const { workspace, people, role: myRole } = team;
  const [inviting, setInviting] = useState(false);
  const [removing, setRemoving] = useState<TeamPerson | null>(null);
  const [busy, setBusy] = useState(false);
  if (!workspace) return null;

  const manages = myRole === "owner" || myRole === "admin";
  const now = Date.now();
  const expired = (p: TeamPerson) => p.status === "invited" && !!p.expiresAt && new Date(p.expiresAt).getTime() < now;
  const used = people.filter((p) => p.status === "active" || (p.status === "invited" && !expired(p))).length;
  // Active people first (owner at the top), then invites, then those who left.
  const order = { active: 0, invited: 1, removed: 2 } as const;
  const rank = (p: TeamPerson) => (p.role === "owner" ? 0 : 1);
  const sorted = [...people].sort((a, b) => order[a.status] - order[b.status] || rank(a) - rank(b) || a.email.localeCompare(b.email));

  const act = async (work: () => PromiseLike<{ error: { message: string } | null }>, done: string) => {
    setBusy(true);
    const { error } = await work();
    setBusy(false);
    if (error) {
      toast.error(problem(error));
      return false;
    }
    toast(done);
    onChanged();
    return true;
  };

  // Not the owner, not yourself, and only the owner changes an admin.
  const canChange = (p: TeamPerson) => manages && p.status === "active" && p.role !== "owner" && p.userId !== userId && (myRole === "owner" || p.role !== "admin");
  // Only the owner gives or takes the Compliance role.
  const canChangeRole = (p: TeamPerson) => canChange(p) && (myRole === "owner" || p.role !== "compliance");
  const changeRole = (p: TeamPerson, next: TeamRole) => void act(() => supabase.rpc("set_member_role", { p_user: p.userId!, p_role: next }), `${p.name ?? p.email} is now ${ROLE_LABEL[next]}`);

  const statusBadge = (p: TeamPerson) =>
    p.status === "active" ? <Badge variant="secondary">Active</Badge>
    : p.status === "invited" ? <Badge variant="outline">{expired(p) ? "Invite Expired" : "Invited"}</Badge>
    : <Badge variant="outline">Removed</Badge>;

  const detail = (p: TeamPerson) =>
    p.status === "invited" ? (p.expiresAt ? `${expired(p) ? "Expired" : "Expires"} ${day(p.expiresAt)}` : undefined)
    : p.status === "removed" ? (p.leftAt ? `Left ${day(p.leftAt)}` : undefined)
    : p.joinedAt ? `Joined ${day(p.joinedAt)}` : undefined;

  return (
    <SettingsSection
      id="members"
      title="Members"
      description={`${used} of ${workspace.seats} seats in use.${manages ? "" : " Only an owner or admin can make changes."}`}
    >
      {manages && (
        <Button variant="secondary" disabled={used >= workspace.seats} onClick={() => setInviting(true)}>
          <UserPlus /> Invite Person
        </Button>
      )}
      <SettingsRows>
        {sorted.map((p) => {
          const label = p.name || p.email;
          return (
            <SettingsRow
              key={p.userId ?? p.inviteId}
              title={<>{label}{p.userId === userId && <span className="font-normal text-muted-foreground">(You)</span>}<Badge variant="outline">{ROLE_LABEL[p.role]}</Badge>{statusBadge(p)}</>}
              description={[p.name ? p.email : null, detail(p)].filter(Boolean).join(", ") || undefined}
            >
              {canChangeRole(p) && (
                <Select value={p.role} onValueChange={(v) => changeRole(p, v as TeamRole)} disabled={busy}>
                  <SelectTrigger className="w-36" aria-label={`Role for ${label}`}><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {assignableRoles(myRole, workspace.strictSharing).map((r) => <SelectItem key={r} value={r}>{ROLE_LABEL[r]}</SelectItem>)}
                  </SelectContent>
                </Select>
              )}
              {canChange(p) && <Button variant="ghost" className="text-destructive hover:text-destructive" disabled={busy} onClick={() => setRemoving(p)}>Remove</Button>}
              {manages && p.status === "invited" && p.inviteId && (
                <Button variant="secondary" disabled={busy} onClick={() => void act(() => supabase.rpc("revoke_invite", { p_invite: p.inviteId! }), "Invite cancelled")}>Cancel Invite</Button>
              )}
            </SettingsRow>
          );
        })}
      </SettingsRows>

      <InviteDialog open={inviting} strict={workspace.strictSharing} myRole={myRole} onClose={() => setInviting(false)} onInvited={onChanged} />

      <AlertDialog open={!!removing} onOpenChange={(open) => !busy && !open && setRemoving(null)}>
        <AlertDialogContent track="remove_member">
          <AlertDialogHeader>
            <AlertDialogTitle>Remove {removing?.name || removing?.email}?</AlertDialogTitle>
            <AlertDialogDescription>
              They leave the team and lose access to anything it shares. Their own mail and chats stay with them, and nothing of theirs is deleted. Their seat is free again.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className={DIALOG_BUTTONS}>
            <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="ghost" className="text-destructive hover:text-destructive"
              disabled={busy}
              onClick={(e) => {
                e.preventDefault();
                const target = removing;
                if (!target?.userId) return;
                void act(() => supabase.rpc("remove_member", { p_user: target.userId! }), `${target.name || target.email} was removed`).then((ok) => ok && setRemoving(null));
              }}
            >
              {busy ? "Removing" : "Remove"}
            </AlertDialogAction>
          </div>
        </AlertDialogContent>
      </AlertDialog>
    </SettingsSection>
  );
}
