"use client";

// Access requests, shown at the top of Admin's Teams view. Nothing writes the waitlist from the website any more (the signup
// form is gone), so this stays quiet until a request arrives some other way. Approving or rejecting changes the status;
// nobody is emailed. Approving a team request makes its team in the same database call (create_workspace) and shows an
// invite link for its owner, to send by hand.

import { useCallback, useEffect, useMemo, useState } from "react";
import { User, Users } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/lib/supabase";
import { inviteLink } from "@/lib/team";
import { teamSeats, teamSizeLabel, type WaitlistKind, type WaitlistStatus } from "@/lib/waitlist";
import { PaneControls, PaneSelect, ViewButtons } from "@/components/pane";
import { EmptyState } from "@/components/primitives";
import { AdminHeading, AdminRow } from "@/components/admin/parts";
import type { OwnerInvite } from "@/components/admin/workspaces";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";

interface Entry {
  id: string;
  kind: WaitlistKind;
  email: string;
  company: string | null;
  team_size: string | null;
  status: WaitlistStatus;
  created_at: string;
}

const STATUSES: { key: WaitlistStatus; label: string }[] = [
  { key: "pending", label: "Pending" },
  { key: "approved", label: "Approved" },
  { key: "rejected", label: "Rejected" },
];
const KINDS = [
  { value: "all", label: "All Requests" },
  { value: "team", label: "Teams" },
  { value: "individual", label: "Individuals" },
];
type KindFilter = "all" | WaitlistKind;

const day = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });

/** The requests list with Approve and Reject. onInvite shows a new team owner's link; onTeamsChanged reloads the team list. */
export function Requests({ version, onInvite, onTeamsChanged, onBusy, onPending }: { version: number; onInvite: (invite: OwnerInvite) => void; onTeamsChanged: () => void; onBusy: (busy: boolean) => void; onPending: (count: number) => void }) {
  const [entries, setEntries] = useState<Entry[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [status, setStatus] = useState<WaitlistStatus>("pending");
  const [kind, setKind] = useState<KindFilter>("all");

  const load = useCallback(async () => {
    onBusy(true);
    setFailed(false);
    const { data, error } = await supabase.from("waitlist").select("id, kind, email, company, team_size, status, created_at").order("created_at", { ascending: false }).limit(1000);
    if (error) setFailed(true);
    else setEntries(data as Entry[]);
    onBusy(false);
  }, [onBusy]);
  useEffect(() => { void load(); }, [load, version]);

  const setLocal = (id: string, next: WaitlistStatus) => setEntries((list) => list?.map((e) => (e.id === id ? { ...e, status: next } : e)) ?? list);

  const decide = useCallback(async (entry: Entry, next: WaitlistStatus, undo = false) => {
    let teamMade = false;
    if (next === "approved" && entry.kind === "team") {
      // The database call also marks the request approved, so a failure cannot leave a team with a pending request.
      const made = await supabase.rpc("create_workspace", { p_name: entry.company ?? "", p_seats: teamSeats(entry.team_size), p_owner_email: entry.email, p_waitlist_id: entry.id });
      if (made.error && made.error.code !== "23505") {
        toast.error(made.error.message || "Could Not Create the Team");
        return;
      }
      if (made.data) {
        const { token } = made.data as { token: string };
        onInvite({ name: entry.company ?? "The Team", email: entry.email, link: inviteLink(token) });
        onTeamsChanged();
        teamMade = true;
      } else {
        toast("This request already has a team. New Invite Link under Teams makes another link.");
      }
    }
    if (!teamMade) {
      const { error } = await supabase.from("waitlist").update({ status: next }).eq("id", entry.id);
      if (error) {
        toast.error("Could Not Update the Request");
        return;
      }
    }
    setLocal(entry.id, next);
    if (undo) return;
    const label = next === "approved" ? "Approved" : next === "rejected" ? "Rejected" : "Moved to Pending";
    // A made team is not unmade by moving the request back, so there is nothing honest to undo.
    toast(`${label} ${entry.email}`, teamMade ? undefined : { action: { label: "Undo", onClick: () => void decide({ ...entry, status: next }, entry.status, true) } });
  }, [onInvite, onTeamsChanged]);

  const counts = useMemo(() => {
    const c: Record<WaitlistStatus, number> = { pending: 0, approved: 0, rejected: 0 };
    for (const e of entries ?? []) if (kind === "all" || e.kind === kind) c[e.status] += 1;
    return c;
  }, [entries, kind]);
  const pending = useMemo(() => (entries ?? []).filter((e) => e.status === "pending").length, [entries]);
  useEffect(() => { onPending(pending); }, [pending, onPending]);
  const shown = useMemo(() => (entries ?? []).filter((e) => e.status === status && (kind === "all" || e.kind === kind)), [entries, status, kind]);

  return (
    <div className="flex flex-col gap-3">
      <AdminHeading title="Requests" description="People asking for access. Approving a team request makes its team and an invite link for its owner." />
      <PaneControls>
        <ViewButtons label="Request Status" value={status} onSelect={setStatus} items={STATUSES.map((x) => ({ key: x.key, label: `${x.label} (${counts[x.key]})` }))} />
        <PaneSelect label="Account Type" value={kind} onChange={(v) => setKind(v as KindFilter)} options={KINDS} className="w-32 shrink-0" />
      </PaneControls>
      {failed ? (
        <EmptyState icon={Users} title="Could Not Load Requests" description="Check your connection and try again." action={<Button variant="secondary" onClick={() => void load()}>Retry</Button>} />
      ) : !entries ? (
        <div className="flex flex-col gap-3"><Skeleton className="h-14 w-full rounded-lg" /><Skeleton className="h-14 w-full rounded-lg" /></div>
      ) : shown.length === 0 ? (
        <div className="py-12">
          <EmptyState icon={Users} title={`No ${STATUSES.find((x) => x.key === status)?.label} Requests`} description={status === "pending" ? "New requests show up here." : "Requests you decide on show up here."} />
        </div>
      ) : (
        shown.map((e, i) => (
          <div key={e.id}>
            {i > 0 && <Separator className="ml-14" />}
            <AdminRow
              icon={e.kind === "team" ? <Users /> : <User />}
              title={e.email}
              description={`${e.kind === "team" ? `${e.company ?? "Team"}, ${teamSizeLabel(e.team_size)}` : "Individual"}, requested ${day(e.created_at)}`}
            >
              {e.status !== "rejected" && <Button variant="ghost" onClick={() => void decide(e, "rejected")}>Reject</Button>}
              {e.status !== "approved" && <Button variant="secondary" onClick={() => void decide(e, "approved")}>Approve</Button>}
            </AdminRow>
          </div>
        ))
      )}
    </div>
  );
}
