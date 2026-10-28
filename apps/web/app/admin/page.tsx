"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/lib/supabase";
import { useAuth, useIsOwner } from "@/lib/auth";
import { inviteLink } from "@/lib/team";
import { teamSeats, teamSizeLabel, type WaitlistKind, type WaitlistStatus } from "@/lib/waitlist";
import { EmptyState, Loading } from "@/components/analytics/parts";
import { AiBudget } from "@/components/admin/ai-budget";
import { AiUsage } from "@/components/admin/ai-usage";
import { OwnerInviteDialog, Workspaces, type OwnerInvite } from "@/components/admin/workspaces";
import { Alert, AlertAction, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Item, ItemActions, ItemContent, ItemDescription, ItemGroup, ItemTitle } from "@/components/ui/item";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";

interface Entry {
  id: string;
  kind: WaitlistKind;
  email: string;
  company: string | null;
  team_size: string | null;
  status: WaitlistStatus;
  created_at: string;
}

const STATUSES: { value: WaitlistStatus; label: string }[] = [
  { value: "pending", label: "Pending" },
  { value: "approved", label: "Approved" },
  { value: "rejected", label: "Rejected" },
];
type KindFilter = "all" | WaitlistKind;

const day = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });

// The waitlist from the marketing page, for the owner only: the database refuses the rows to anyone else.
// Approving or rejecting changes the status; nobody is emailed yet. Approving a team request also makes its team
// and shows an invite link for its owner, to send by hand.
export default function AdminPage() {
  const router = useRouter();
  const { session } = useAuth();
  const isOwner = useIsOwner();
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

  if (!isOwner) {
    return session ? (
      <div className="w-full max-w-4xl p-3">
        <EmptyState title="Owner Only">Admin is only for the owner of this app.</EmptyState>
      </div>
    ) : null;
  }

  return (
    <ScrollArea className="h-full">
      <div className="w-full max-w-4xl p-3">
        <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h1 className="flex h-10 items-center text-lg font-medium">Admin</h1>
            <p className="mt-1 text-sm text-muted-foreground">Requests for access from the marketing page, the teams they become, and the AI budget for each seat.</p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <Select value={kind} onValueChange={(v) => setKind(v as KindFilter)}>
              <SelectTrigger className="w-36" aria-label="Account Type"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Requests</SelectItem>
                <SelectItem value="team">Teams</SelectItem>
                <SelectItem value="individual">Individuals</SelectItem>
              </SelectContent>
            </Select>
            <Button variant="outline" size="icon" aria-label="Refresh" disabled={busy} onClick={() => void load()}><RefreshCw className={busy ? "animate-spin" : undefined} /></Button>
          </div>
        </div>
        {failed && (
          <Alert variant="destructive" className="mb-6">
            <AlertTitle>Could Not Load the Waitlist</AlertTitle>
            <AlertDescription>Check your connection and try again.</AlertDescription>
            <AlertAction>
              <Button size="sm" variant="outline" disabled={busy} onClick={() => void load()}>Retry</Button>
            </AlertAction>
          </Alert>
        )}
        {!entries ? (
          !failed && <Loading />
        ) : (
          <div className="flex flex-col gap-6">
            <Tabs value={status} onValueChange={(v) => setStatus(v as WaitlistStatus)}>
              <TabsList>
                {STATUSES.map((s) => <TabsTrigger key={s.value} value={s.value}>{s.label} ({counts[s.value]})</TabsTrigger>)}
              </TabsList>
            </Tabs>
            {shown.length === 0 ? (
              <EmptyState title={`No ${STATUSES.find((s) => s.value === status)?.label} Requests`}>
                {status === "pending" ? "New requests from the marketing page show up here." : "Requests you decide on show up here."}
              </EmptyState>
            ) : (
              <ItemGroup className="gap-2">
                {shown.map((e) => (
                  <Item key={e.id} variant="outline">
                    <ItemContent>
                      <ItemTitle>
                        {e.kind === "team" ? e.company : e.email}
                        <Badge variant="secondary">{e.kind === "team" ? teamSizeLabel(e.team_size) : "Individual"}</Badge>
                      </ItemTitle>
                      <ItemDescription>{e.kind === "team" ? `${e.email}, requested ${day(e.created_at)}` : `Requested ${day(e.created_at)}`}</ItemDescription>
                    </ItemContent>
                    <ItemActions>
                      {e.status !== "rejected" && <Button size="sm" variant="outline" onClick={() => void decide(e, "rejected")}>Reject</Button>}
                      {e.status !== "approved" && <Button size="sm" onClick={() => void decide(e, "approved")}>Approve</Button>}
                    </ItemActions>
                  </Item>
                ))}
              </ItemGroup>
            )}
          </div>
        )}
        <div className="mt-10"><Workspaces version={teamsVersion} onInvite={setOwnerInvite} /></div>
        <div className="mt-10"><AiUsage /></div>
        <div className="mt-10"><AiBudget /></div>
      </div>
      <OwnerInviteDialog invite={ownerInvite} onClose={() => setOwnerInvite(null)} />
    </ScrollArea>
  );
}
