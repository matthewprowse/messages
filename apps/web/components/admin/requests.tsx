"use client";

// Access requests, the first card of Admin's Teams view, filtered by status and kind from its title row. The marketing
// site's Request Access form writes them (/api/waitlist). Approving or rejecting changes the status; nobody is emailed.
// Approving a team request makes its team in the same database call (create_workspace) and shows an invite link for its
// owner, to send by hand.

import { useCallback, useEffect, useMemo, useState } from "react";
import { User, Users } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/lib/supabase";
import { inviteLink } from "@/lib/team";
import { teamSeats, teamSizeLabel, type WaitlistKind, type WaitlistStatus } from "@/lib/waitlist";
import { PaneSelect } from "@/components/pane";
import { Card, IconCircle, Row, Separated } from "@/components/surface";
import { Button } from "@/components/ui/button";
import { Failed, LoadingCard, Quiet } from "./parts";
import type { OwnerInvite } from "./workspaces";

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

  const statusLabel = STATUSES.find((x) => x.key === status)?.label;
  const pickers = (
    <div className="flex shrink-0 items-center gap-1">
      <PaneSelect label="Request Status" value={status} onChange={(v) => setStatus(v as WaitlistStatus)} options={STATUSES.map((x) => ({ value: x.key, label: `${x.label} ${counts[x.key]}` }))} className="w-32" />
      <PaneSelect label="Account Type" value={kind} onChange={(v) => setKind(v as KindFilter)} options={KINDS} className="w-32" />
    </div>
  );
  if (failed) return <Failed title="Could Not Load Requests" onRetry={() => void load()} />;
  if (!entries) return <LoadingCard title="Requests" />;
  return (
    <Card title="Requests" action={pickers}>
      {shown.length === 0 ? <Quiet>No {statusLabel} Requests</Quiet> : (
        <Separated>
          {shown.map((e) => (
            <Row
              key={e.id}
              lead={<IconCircle icon={e.kind === "team" ? Users : User} />}
              title={e.email}
              meta={day(e.created_at)}
              detail={e.kind === "team" ? `${e.company ?? "Team"}, ${teamSizeLabel(e.team_size)}` : "Individual"}
              end={
                <>
                  {e.status !== "rejected" && <Button variant="ghost" onClick={() => void decide(e, "rejected")}>Reject</Button>}
                  {e.status !== "approved" && <Button variant="secondary" onClick={() => void decide(e, "approved")}>Approve</Button>}
                </>
              }
            />
          ))}
        </Separated>
      )}
    </Card>
  );
}
