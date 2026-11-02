"use client";

// Admin view of AI spend per account: month, week and day in dollars, calls, a share of the budget and a flag when an account stands out.
// Loaded from Supabase; shows cost figures only, never message content.

import { useCallback, useEffect, useState } from "react";
import { Gauge } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { EmptyState } from "@/components/primitives";
import { AdminHeading, AdminRow } from "@/components/admin/parts";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";

type Row = {
  user_id: string;
  email: string | null;
  accounts: string[];
  month_usd: number;
  week_usd: number;
  day_usd: number;
  setup_usd: number;
  calls: number;
  month_pct: number;
  by_feature: Record<string, number | null>; // null for a feature whose only spend this month was setup work
  flag: string | null;
};

const FEATURE_LABEL: Record<string, string> = { triage: "Sorting", draft: "Drafts", learn: "Learning", brief: "Brief", transcribe: "Transcripts", bulk_read: "Readable Bulk Email" };
const PROVIDER_LABEL: Record<string, string> = {
  gmail: "Gmail", icloud: "iCloud Mail", outlook: "Outlook", imap: "Other Email", whatsapp: "WhatsApp", google_calendar: "Google Calendar",
  outlook_calendar: "Outlook Calendar", icloud_calendar: "iCloud Calendar", teams: "Teams", zoom: "Zoom", google_meet: "Google Meet",
  linkedin: "LinkedIn", instagram: "Instagram", microsoft_todo: "Microsoft To Do", google_tasks: "Google Tasks", icloud_reminders: "iCloud Reminders",
};
const money = (usd: number) => (usd === 0 ? "$0.00" : usd < 1 ? `$${usd.toFixed(3)}` : `$${usd.toFixed(2)}`);

/** What each person has used this month, in dollars, for the owner. Flagged accounts are marked; a flag blocks nothing. */
export function AiUsage({ version, onBusy }: { version: number; onBusy: (busy: boolean) => void }) {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [failed, setFailed] = useState(false);

  const load = useCallback(async () => {
    onBusy(true);
    setFailed(false);
    const { data, error } = await supabase.rpc("ai_usage_by_user");
    if (error) setFailed(true);
    else setRows((data ?? []) as unknown as Row[]);
    onBusy(false);
  }, [onBusy]);
  useEffect(() => { void load(); }, [load, version]);

  return (
    <div className="flex flex-col gap-3">
      <AdminHeading
        title="AI Usage by Person"
        description="What each person has used this month in dollars. This month and this week leave out setup work, which is shown separately. Flagged accounts passed the amounts set under AI Budget; nothing is blocked automatically."
      />
      {failed ? (
        <EmptyState icon={Gauge} title="Could Not Load AI Usage" description="Check your connection and refresh." />
      ) : rows === null ? (
        <div className="flex flex-col gap-3"><Skeleton className="h-16 w-full rounded-lg" /><Skeleton className="h-16 w-full rounded-lg" /></div>
      ) : rows.length === 0 ? (
        <div className="py-12"><EmptyState icon={Gauge} title="No AI Use Yet" description="No AI use this month yet." /></div>
      ) : (
        <div>
          {rows.map((r, i) => {
            const features = Object.entries(r.by_feature).filter((e): e is [string, number] => e[1] != null).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${FEATURE_LABEL[k] ?? k} ${money(v)}`).join(", ");
            return (
              <div key={r.user_id}>
                {i > 0 && <Separator className="ml-3" />}
                <AdminRow
                  title={<>{r.email ?? r.user_id.slice(0, 8)}{r.flag && <Badge variant="destructive">{r.flag}</Badge>}</>}
                  description={
                    <>
                      <div>{r.accounts.length > 0 ? r.accounts.map((p) => PROVIDER_LABEL[p] ?? p).join(", ") : "No accounts connected"}</div>
                      <div>Week {money(r.week_usd)}, Today {money(r.day_usd)}, Setup {money(r.setup_usd)}, {r.calls.toLocaleString()} Calls{features ? `, ${features}` : ""}</div>
                    </>
                  }
                >
                  <div className="text-right">
                    <div className="text-sm font-medium tabular-nums">{money(r.month_usd)}</div>
                    <div className="text-xs text-muted-foreground tabular-nums">{Math.round(r.month_pct)}% This Month</div>
                  </div>
                </AdminRow>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
