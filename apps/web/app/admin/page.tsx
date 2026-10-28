"use client";

// The waitlist, for the owner only: the database refuses the rows to anyone else.
// Approving or rejecting changes the status; nobody is emailed yet. Approving a team request also makes its team
// and shows an invite link for its owner, to send by hand.

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw, ShieldCheck, User, Users } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/lib/supabase";
import { useAuth, useIsOwner } from "@/lib/auth";
import { inviteLink } from "@/lib/team";
import { teamSeats, teamSizeLabel, type WaitlistKind, type WaitlistStatus } from "@/lib/waitlist";
import { PaneControls, PaneHeader, PaneSelect, ViewButtons } from "@/components/pane";
import { EmptyState } from "@/components/primitives";
import { AiBudget } from "@/components/admin/ai-budget";
import { AiUsage } from "@/components/admin/ai-usage";
import { AdminColumn, AdminRow } from "@/components/admin/parts";
import { OwnerInviteDialog, Workspaces, type OwnerInvite } from "@/components/admin/workspaces";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
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

type View = "waitlist" | "teams" | "usage" | "budget";
const VIEWS: { key: View; label: string }[] = [
  { key: "waitlist", label: "Waitlist" },
  { key: "teams", label: "Teams" },
  { key: "usage", label: "AI Usage" },
  { key: "budget", label: "AI Budget" },
];
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

export default function AdminPage() {
  const router = useRouter();
  const { session } = useAuth();
  const isOwner = useIsOwner();
  const [view, setView] = useState<View>("waitlist");
  const [tick, setTick] = useState(0);
  const [childBusy, setChildBusy] = useState(false);
  const [entries, setEntries] = useState<Entry[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<WaitlistStatus>("pending");
  const [kind, setKind] = useState<KindFilter>("all");
  const [ownerInvite, setOwnerInvite] = useState<OwnerInvite | null>(null);
  const [teamsVersion, setTeamsVersion] = useState(0);

  useEffect(() => {
    if (session && !isOwner) router.replace("/inbox");
  }, [session, isOwner, router]);

  const load = useCallback(async () => {
    setBusy(true);
    setFailed(false);
    const { data, error } = await supabase
      .from("waitlist")
      .select("id, kind, email, company, team_size, status, created_at")
      .order("created_at", { ascending: false })
      .limit(1000);
    if (error) setFailed(true);
    else setEntries(data as Entry[]);
    setBusy(false);
  }, []);
  useEffect(() => {
    if (isOwner) void load();
  }, [isOwner, load]);

  const decide = useCallback(async (entry: Entry, next: WaitlistStatus, undo = false) => {
    // A team request makes its team on approval. Approving it again after an undo finds the team already there.
    if (next === "approved" && entry.kind === "team" && !undo) {
      const made = await supabase.rpc("create_workspace", { p_name: entry.company ?? "", p_seats: teamSeats(entry.team_size), p_owner_email: entry.email, p_waitlist_id: entry.id });
      if (made.error && made.error.code !== "23505") {
        toast.error(made.error.message || "Could Not Create the Team");
        return;
      }
      if (made.data) {
        const { token } = made.data as { token: string };
        setOwnerInvite({ name: entry.company ?? "The Team", email: entry.email, link: inviteLink(token) });
        setTeamsVersion((v) => v + 1);
      } else {
        toast("This request already has a team. New Invite Link under Teams makes another link.");
      }
    }
    const { error } = await supabase.from("waitlist").update({ status: next }).eq("id", entry.id);
    if (error) {
      toast.error("Could Not Update the Request");
      return;
    }
    setEntries((list) => list?.map((e) => (e.id === entry.id ? { ...e, status: next } : e)) ?? list);
    if (undo) return;
    const label = next === "approved" ? "Approved" : next === "rejected" ? "Rejected" : "Moved to Pending";
    toast(`${label} ${entry.email}`, { action: { label: "Undo", onClick: () => void decide({ ...entry, status: next }, entry.status, true) } });
  }, []);

  const counts = useMemo(() => {
    const c: Record<WaitlistStatus, number> = { pending: 0, approved: 0, rejected: 0 };
    for (const e of entries ?? []) if (kind === "all" || e.kind === kind) c[e.status] += 1;
    return c;
  }, [entries, kind]);
  const shown = useMemo(() => (entries ?? []).filter((e) => e.status === status && (kind === "all" || e.kind === kind)), [entries, status, kind]);

  const busyNow = view === "waitlist" ? busy : childBusy;
  const refresh = () => (view === "waitlist" ? void load() : setTick((t) => t + 1));

  if (!isOwner) {
    return session ? (
      <div className="flex h-full min-h-0 flex-col">
        <EmptyState icon={ShieldCheck} title="Owner Only" description="Admin is only for the owner of this app." />
      </div>
    ) : null;
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="shrink-0">
        <PaneHeader title="Admin" action={<Button variant="ghost" size="icon" aria-label="Refresh" disabled={busyNow} onClick={refresh}><RefreshCw className={busyNow ? "animate-spin" : undefined} /></Button>}>
          <PaneControls>
            <ViewButtons label="Admin Sections" value={view} onSelect={setView} items={VIEWS} />
          </PaneControls>
          {view === "waitlist" && (
            <PaneControls>
              <ViewButtons label="Request Status" value={status} onSelect={setStatus} items={STATUSES.map((x) => ({ key: x.key, label: `${x.label} (${counts[x.key]})` }))} />
              <PaneSelect label="Account Type" value={kind} onChange={(v) => setKind(v as KindFilter)} options={KINDS} className="w-32 shrink-0" />
            </PaneControls>
          )}
        </PaneHeader>
      </div>
      <ScrollArea className="min-h-0 flex-1">
        <AdminColumn>
          {view === "waitlist" && (
            failed ? (
              <EmptyState icon={Users} title="Could Not Load the Waitlist" description="Check your connection and try again." action={<Button variant="secondary" disabled={busy} onClick={() => void load()}>Retry</Button>} />
            ) : !entries ? (
              <div className="flex flex-col gap-3"><Skeleton className="h-14 w-full rounded-lg" /><Skeleton className="h-14 w-full rounded-lg" /></div>
            ) : shown.length === 0 ? (
              <div className="py-24">
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
            )
          )}
          {view === "teams" && <Workspaces version={teamsVersion + tick} onInvite={setOwnerInvite} onBusy={setChildBusy} />}
          {view === "usage" && <AiUsage version={tick} onBusy={setChildBusy} />}
          {view === "budget" && <AiBudget />}
        </AdminColumn>
      </ScrollArea>
      <OwnerInviteDialog invite={ownerInvite} onClose={() => setOwnerInvite(null)} />
    </div>
  );
}
