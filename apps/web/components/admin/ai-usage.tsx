"use client";

import { useCallback, useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { Table, type Col } from "@/components/analytics/parts";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { SettingsSection } from "@/components/settings/sections";

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
  by_feature: Record<string, number>;
  flag: string | null;
};

const FEATURE_LABEL: Record<string, string> = { triage: "Sorting", draft: "Drafts", learn: "Learning", brief: "Brief", transcribe: "Transcripts" };
const PROVIDER_LABEL: Record<string, string> = {
  gmail: "Gmail", icloud: "iCloud Mail", outlook: "Outlook", imap: "Other Email", whatsapp: "WhatsApp", google_calendar: "Google Calendar",
  outlook_calendar: "Outlook Calendar", icloud_calendar: "iCloud Calendar", teams: "Teams", zoom: "Zoom", google_meet: "Google Meet",
  linkedin: "LinkedIn", instagram: "Instagram", microsoft_todo: "Microsoft To Do", google_tasks: "Google Tasks", icloud_reminders: "iCloud Reminders",
};
const money = (usd: number) => (usd === 0 ? "$0.00" : usd < 1 ? `$${usd.toFixed(3)}` : `$${usd.toFixed(2)}`);

/** What each person has used this month, in dollars, for the owner. Flagged accounts are marked; a flag blocks nothing. */
export function AiUsage() {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setBusy(true);
    setFailed(false);
    const { data, error } = await supabase.rpc("ai_usage_by_user");
    if (error) setFailed(true);
    else setRows((data ?? []) as unknown as Row[]);
    setBusy(false);
  }, []);
  useEffect(() => { void load(); }, [load]);

  const cols: Col<Row>[] = [
    {
      head: "Sign-In",
      cell: (r) => (
        <div>
          <span className="whitespace-nowrap">{r.email ?? r.user_id.slice(0, 8)}{r.flag && <Badge variant="destructive" className="ml-2">{r.flag}</Badge>}</span>
          <div className="text-xs text-muted-foreground">{r.accounts.length > 0 ? r.accounts.map((p) => PROVIDER_LABEL[p] ?? p).join(", ") : "No accounts connected"}</div>
        </div>
      ),
    },
    { head: "This Month", cell: (r) => <span>{money(r.month_usd)} <span className="text-xs text-muted-foreground">{Math.round(r.month_pct)}%</span></span>, num: true },
    { head: "This Week", cell: (r) => money(r.week_usd), num: true, wide: true },
    { head: "Today", cell: (r) => money(r.day_usd), num: true, wide: true },
    { head: "Setup", cell: (r) => money(r.setup_usd), num: true, wide: true },
    { head: "Calls", cell: (r) => r.calls.toLocaleString(), num: true, wide: true },
    {
      head: "By Feature",
      wide: true,
      cell: (r) => (
        <span className="text-xs text-muted-foreground">
          {Object.entries(r.by_feature).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${FEATURE_LABEL[k] ?? k} ${money(v)}`).join(", ")}
        </span>
      ),
    },
  ];

  return (
    <SettingsSection
      title="AI Usage by Person"
      description="What each person has used this month in dollars. This month and this week leave out setup work, which is shown separately. Flagged accounts passed the amounts set under AI Budget; nothing is blocked automatically."
    >
      <div className="flex justify-end">
        <Button variant="outline" size="icon" aria-label="Refresh AI usage" disabled={busy} onClick={() => void load()}><RefreshCw className={busy ? "animate-spin" : undefined} /></Button>
      </div>
      {failed ? <p className="text-sm text-muted-foreground">Could not load. Check your connection and refresh.</p> : rows === null ? <Skeleton className="h-32 w-full rounded-lg" /> : <Table cols={cols} rows={rows} empty="No AI use this month yet." />}
    </SettingsSection>
  );
}
