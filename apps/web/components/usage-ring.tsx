"use client";

// The usage ring at the bottom of the navigation rail: how close you are to your nearest limit, with every limit on hover.
// Reads the same sources as Settings, Usage (my_ai_allowance, storage_usage, my_team_storage) and links there on click.

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { STORAGE_CAP_BYTES, bytesLabel } from "@/lib/storage";
import { closestLimit, featuresOf, limitsOf, pctLabel, resetsLabel, type Allowance, type StorageUse } from "@/lib/usage";
import { Button } from "@/components/ui/button";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";

const STALE_MS = 60_000; // opening the card again within a minute shows what was loaded, without asking again

async function loadStorage(): Promise<StorageUse | null> {
  const me = (await supabase.auth.getSession()).data.session?.user.id ?? "";
  const [usage, team] = await Promise.all([supabase.from("storage_usage").select("bytes").eq("user_id", me), supabase.rpc("my_team_storage")]);
  if (usage.error) return null;
  // Someone in a team is measured against the team's total, which everyone on it shares.
  const pool = team.data as unknown as { seats: number; bytes: number } | null;
  if (pool) return { held: Number(pool.bytes), cap: Number(pool.seats) * STORAGE_CAP_BYTES, team: true };
  return { held: (usage.data ?? []).reduce((n, r) => n + Number(r.bytes ?? 0), 0), cap: STORAGE_CAP_BYTES, team: false };
}

function useUsage() {
  const [allowance, setAllowance] = useState<Allowance | null>(null);
  const [storage, setStorage] = useState<StorageUse | null>(null);
  const [loaded, setLoaded] = useState(false);
  const at = useRef(0);
  const refresh = useCallback(async (force = false) => {
    if (!force && Date.now() - at.current < STALE_MS) return;
    at.current = Date.now();
    const [ai, files] = await Promise.all([supabase.rpc("my_ai_allowance").then((r) => (r.error ? null : (r.data as unknown as Allowance | null))), loadStorage().catch(() => null)]);
    setAllowance(ai);
    setStorage(files);
    setLoaded(true);
  }, []);
  // Once the first page has settled; it is a glance, not something the page waits on.
  useEffect(() => {
    const id = window.setTimeout(() => void refresh(true), 2000);
    return () => window.clearTimeout(id);
  }, [refresh]);
  return { allowance, storage, loaded, refresh };
}

function Ring({ pct, full }: { pct: number; full: boolean }) {
  const r = 8;
  const c = 2 * Math.PI * r;
  return (
    <svg viewBox="0 0 20 20" className="size-4 -rotate-90" aria-hidden>
      <circle cx="10" cy="10" r={r} fill="none" strokeWidth="2.5" className="stroke-muted" />
      <circle cx="10" cy="10" r={r} fill="none" strokeWidth="2.5" strokeLinecap="round" strokeDasharray={c} strokeDashoffset={c * (1 - pct / 100)} className={cn("transition-[stroke-dashoffset]", full ? "stroke-destructive" : "stroke-primary")} />
    </svg>
  );
}

export function UsageRing() {
  const pathname = usePathname();
  const { allowance, storage, loaded, refresh } = useUsage();
  const limits = limitsOf(allowance, storage);
  const closest = closestLimit(limits);
  const pct = closest?.pct ?? 0;
  const features = allowance ? featuresOf(allowance) : [];
  const active = pathname.startsWith("/settings/usage");

  return (
    <HoverCard openDelay={150} closeDelay={100} onOpenChange={(open) => { if (open) void refresh(); }}>
      <HoverCardTrigger asChild>
        <Button asChild variant={active ? "secondary" : "ghost"} size="icon">
          <Link href="/settings/usage" aria-label={closest ? `Usage, ${pctLabel(pct)} of ${closest.label} Used` : "Usage"} aria-current={active ? "page" : undefined}>
            <Ring pct={pct} full={pct >= 100} />
          </Link>
        </Button>
      </HoverCardTrigger>
      <HoverCardContent side="right" align="end" className="w-72">
        <div className="flex flex-col gap-3">
          <div className="font-medium">Usage</div>
          {!loaded ? (
            <p className="text-xs text-muted-foreground">Loading.</p>
          ) : limits.length === 0 ? (
            <p className="text-xs text-muted-foreground">Could not load your usage. Check your connection and try again.</p>
          ) : (
            limits.map((l) => (
              <div key={l.key} className="flex flex-col gap-1.5">
                <div className="flex items-baseline justify-between gap-2 text-xs">
                  <span className="font-medium">{l.label}</span>
                  <span className="tabular-nums text-muted-foreground">{pctLabel(l.pct)} Used</span>
                </div>
                <Progress value={l.pct} aria-label={`${l.label} used`} />
                <div className="text-xs text-muted-foreground">
                  {l.key === "storage" && storage ? `${bytesLabel(storage.held)} of ${bytesLabel(storage.cap)}` : l.resetsAt ? `Resets ${resetsLabel(l.resetsAt)}` : null}
                </div>
              </div>
            ))
          )}
          {features.length > 0 && (
            <>
              <Separator />
              <div className="flex flex-col gap-1">
                <div className="text-xs font-medium">AI Features This Month</div>
                {features.map((f) => (
                  <div key={f.feature} className="flex items-baseline justify-between gap-2 text-xs">
                    <span className="truncate text-muted-foreground">{f.label}</span>
                    <span className="shrink-0 tabular-nums">{f.pausedUntil ? `Paused Until ${resetsLabel(f.pausedUntil)}` : pctLabel(f.pct)}</span>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      </HoverCardContent>
    </HoverCard>
  );
}
