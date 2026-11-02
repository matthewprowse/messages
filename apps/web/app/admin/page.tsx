"use client";

// Admin, for the owner only: the database refuses every view's rows to anyone else. It opens on AI Usage (the Gemini billing
// state and who is flagged or paused), then AI Budget, Teams (with access Requests on top) and Updates, the changelog,
// which used to sit in the main rail. Every view stays mounted and is hidden when not shown, so the budget form keeps
// unsaved edits across tabs; the header Refresh asks each view to reload.

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw, ShieldCheck } from "lucide-react";
import { useAuth, useIsOwner } from "@/lib/auth";
import { PaneControls, PaneHeader, ViewButtons } from "@/components/pane";
import { EmptyState } from "@/components/primitives";
import { AiBudget } from "@/components/admin/ai-budget";
import { AiUsage } from "@/components/admin/ai-usage";
import { AdminColumn } from "@/components/admin/parts";
import { Requests } from "@/components/admin/requests";
import { OwnerInviteDialog, Workspaces, type OwnerInvite } from "@/components/admin/workspaces";
import { UpdatesPanel } from "@/components/updates/updates-panel";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";

type View = "usage" | "budget" | "teams" | "updates";

const count = (label: string, n: number) => (n > 0 ? `${label} (${n})` : label);

export default function AdminPage() {
  const router = useRouter();
  const { session } = useAuth();
  const isOwner = useIsOwner();
  const [view, setView] = useState<View>("usage");
  const [tick, setTick] = useState(0);
  const [busyCount, setBusyCount] = useState(0);
  const [attention, setAttention] = useState(0);
  const [pending, setPending] = useState(0);
  const [ownerInvite, setOwnerInvite] = useState<OwnerInvite | null>(null);
  const [teamsVersion, setTeamsVersion] = useState(0);

  useEffect(() => {
    if (session && !isOwner) router.replace("/inbox");
  }, [session, isOwner, router]);

  // Several views load at once, so busy is a count rather than a flag any one of them could clear.
  const onBusy = useCallback((busy: boolean) => setBusyCount((n) => Math.max(0, n + (busy ? 1 : -1))), []);
  const onTeamsChanged = useCallback(() => setTeamsVersion((v) => v + 1), []);

  if (!isOwner) {
    return session ? (
      <div className="flex h-full min-h-0 flex-col">
        <EmptyState icon={ShieldCheck} title="Owner Only" description="Admin is only for the owner of this app." />
      </div>
    ) : null;
  }

  const items: { key: View; label: string }[] = [
    { key: "usage", label: count("AI Usage", attention) },
    { key: "budget", label: "AI Budget" },
    { key: "teams", label: count("Teams", pending) },
    { key: "updates", label: "Updates" },
  ];
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="shrink-0">
        <PaneHeader title="Admin" action={<Button variant="ghost" size="icon" aria-label="Refresh" disabled={busyCount > 0} onClick={() => setTick((t) => t + 1)}><RefreshCw className={busyCount > 0 ? "animate-spin" : undefined} /></Button>}>
          <PaneControls>
            <ViewButtons label="Admin Sections" value={view} onSelect={setView} items={items} />
          </PaneControls>
        </PaneHeader>
      </div>
      <ScrollArea className="min-h-0 flex-1">
        <AdminColumn>
          <div hidden={view !== "usage"}><AiUsage version={tick} onBusy={onBusy} onAttention={setAttention} /></div>
          <div hidden={view !== "budget"}><AiBudget version={tick} onBusy={onBusy} /></div>
          <div className={view === "teams" ? "flex flex-col gap-6" : "hidden"}>
            <Requests version={tick} onInvite={setOwnerInvite} onTeamsChanged={onTeamsChanged} onBusy={onBusy} onPending={setPending} />
            <Workspaces version={teamsVersion + tick} onInvite={setOwnerInvite} onBusy={onBusy} />
          </div>
          <div hidden={view !== "updates"}><UpdatesPanel /></div>
        </AdminColumn>
      </ScrollArea>
      <OwnerInviteDialog invite={ownerInvite} onClose={() => setOwnerInvite(null)} />
    </div>
  );
}
