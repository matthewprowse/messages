"use client";

// Admin view for the monthly AI budget: how it is shared between features, on/off switches per feature and the abuse limits.
// Reads and saves through Supabase.

import { useEffect, useState } from "react";
import { Wallet } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/lib/supabase";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/primitives";
import { AdminHeading, AdminRow } from "@/components/admin/parts";

// In the order people see them. A feature missing from the shares is not limited.
const FEATURES: { key: string; label: string; note: string }[] = [
  { key: "triage", label: "Sorting and Junk", note: "Sorts new mail. Pausing it leaves new mail unsorted until the 1st." },
  { key: "draft", label: "Drafts", note: "Automatic and on-request drafts, regenerations and voice drafts." },
  { key: "learn", label: "Learning From Edits", note: "Reads your edits and embeds mail for search." },
  { key: "brief", label: "Daily Brief", note: "The daily brief and its spoken version." },
  { key: "transcribe", label: "Transcripts", note: "Voice note and meeting transcripts." },
];

type LimitKey = "regen_per_hour" | "auto_drafts_per_day" | "summaries_per_day" | "flag_multiple" | "flag_day_usd";
const LIMITS: { key: LimitKey; title: string; description: string; unit: string; whole?: boolean; max: number }[] = [
  { key: "regen_per_hour", title: "Drafts per Conversation per Hour", description: "Drafts, regenerations and voice drafts a person can ask for in one conversation in an hour.", unit: "Drafts", whole: true, max: 1000 },
  { key: "auto_drafts_per_day", title: "Automatic Drafts per Conversation per Day", description: "Drafts made without being asked, for one conversation in a day.", unit: "Drafts", whole: true, max: 1000 },
  { key: "summaries_per_day", title: "Contact Summaries per Day", description: "Contact and company summaries learned for one person in a day. A large import catches up over several days.", unit: "Summaries", whole: true, max: 100000 },
  { key: "flag_multiple", title: "Flag Above Middle Person", description: "Flag an account whose month is this many times the middle person's, and over $1.", unit: "Times", max: 1000 },
  { key: "flag_day_usd", title: "Flag Above Daily Amount", description: "Flag an account that uses more than this in one day, setup included.", unit: "$", max: 1000 },
];

function BudgetRow({ title, description, children }: { title: string; description?: string; children: React.ReactNode }) {
  return <AdminRow title={title} description={description}>{children}</AdminRow>;
}

const money = (usd: number) => `$${usd.toFixed(2)}`;

/**
 * The most the AI may cost for each seat in a month, and how it is divided between features. A team shares its seats times this amount. A feature
 * pauses for a person when their share of it is spent, until the 1st. People are shown percentages only.
 */
export function AiBudget() {
  const [monthly, setMonthly] = useState("");
  const [shares, setShares] = useState<Record<string, string>>({});
  const [weeklyPct, setWeeklyPct] = useState("");
  const [weekly, setWeekly] = useState<string[]>([]);
  const [setupUsd, setSetupUsd] = useState("");
  const [setupDays, setSetupDays] = useState("");
  const [limits, setLimits] = useState<Record<LimitKey, string>>({ regen_per_hour: "", auto_drafts_per_day: "", summaries_per_day: "", flag_multiple: "", flag_day_usd: "" });
  const [saved, setSaved] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void supabase.from("ai_budget").select("monthly_usd, shares, weekly_pct, weekly_features, setup_usd, setup_days, regen_per_hour, auto_drafts_per_day, summaries_per_day, flag_multiple, flag_day_usd").maybeSingle().then(({ data, error }) => {
      if (cancelled) return;
      if (error || !data) return setFailed(true);
      const s = data.shares as Record<string, number>;
      setMonthly(String(data.monthly_usd));
      setShares(Object.fromEntries(FEATURES.map((f) => [f.key, String(s[f.key] ?? 0)])));
      setWeeklyPct(String(data.weekly_pct));
      setWeekly(data.weekly_features);
      setSetupUsd(String(data.setup_usd));
      setSetupDays(String(data.setup_days));
      const l: Record<LimitKey, string> = Object.fromEntries(LIMITS.map((x) => [x.key, String(data[x.key])])) as Record<LimitKey, string>;
      setLimits(l);
      setSaved(JSON.stringify([Number(data.monthly_usd), ...FEATURES.map((f) => Number(s[f.key] ?? 0)), Number(data.weekly_pct), [...data.weekly_features].sort(), Number(data.setup_usd), Number(data.setup_days), ...LIMITS.map((x) => Number(data[x.key]))]));
    });
    return () => { cancelled = true; };
  }, []);

  if (failed) return <EmptyState icon={Wallet} title="Could Not Load the AI Budget" description="Check your connection and reopen this page." />;
  if (saved === null) return <Skeleton className="h-40 w-full rounded-lg" />;

  const total = Number(monthly);
  const parts = FEATURES.map((f) => Number(shares[f.key]));
  const sum = parts.reduce((n, v) => n + v, 0);
  const week = Number(weeklyPct);
  const setup = Number(setupUsd);
  const days = Number(setupDays);
  const valid =
    total > 0 && total <= 1000 && parts.every((v) => Number.isFinite(v) && v >= 0 && v <= 100) && Math.round(sum * 100) === 10000 &&
    week > 0 && week <= 100 && Number.isFinite(setup) && setup >= 0 && setup <= 1000 && Number.isInteger(days) && days >= 1 && days <= 60 &&
    LIMITS.every((x) => { const v = Number(limits[x.key]); return limits[x.key].trim() !== "" && Number.isFinite(v) && v >= 1 && v <= x.max && (!x.whole || Number.isInteger(v)); });
  const snapshot = () => JSON.stringify([total, ...parts, week, [...weekly].sort(), setup, days, ...LIMITS.map((x) => Number(limits[x.key]))]);
  const changed = snapshot() !== saved;

  const save = async () => {
    setBusy(true);
    const next = Object.fromEntries(FEATURES.map((f, i) => [f.key, parts[i]]));
    const { error } = await supabase.from("ai_budget").update({ monthly_usd: total, shares: next, weekly_pct: week, weekly_features: weekly, setup_usd: setup, setup_days: days, ...Object.fromEntries(LIMITS.map((x) => [x.key, Number(limits[x.key])])), updated_at: new Date().toISOString() }).eq("id", true);
    setBusy(false);
    if (error) return toast.error("Could Not Save the AI Budget");
    setSaved(snapshot());
    toast("AI Budget Saved");
  };

  return (
    <div className="flex flex-col gap-3">
      <AdminHeading
        title="AI Budget"
        description="The most the AI may cost for each seat in a month, and how it is divided between features. A team shares its seats times this amount. A feature pauses for a person once their share is spent, until the 1st. People see percentages only, never dollars. Changes apply within a minute."
      />
      <div>
        <BudgetRow title="Monthly Budget per Seat" description="In US dollars, at Google's published Gemini prices.">
          <Input aria-label="Monthly budget per seat in dollars" inputMode="decimal" className="w-24 text-right" value={monthly} onChange={(e) => setMonthly(e.target.value)} />
        </BudgetRow>
        {FEATURES.map((f) => {
          const pct = Number(shares[f.key]);
          return (
            <BudgetRow key={f.key} title={f.label} description={`${f.note}${Number.isFinite(pct) && total > 0 ? ` Up to ${money((total * pct) / 100)} a month.` : ""}`}>
              <div className="flex items-center gap-2">
                <Input aria-label={`${f.label} share in percent`} inputMode="decimal" className="w-20 text-right" value={shares[f.key]} onChange={(e) => setShares((s) => ({ ...s, [f.key]: e.target.value }))} />
                <span className="text-sm text-muted-foreground">%</span>
              </div>
            </BudgetRow>
          );
        })}
        <BudgetRow title="Total" description={Math.round(sum * 100) === 10000 ? undefined : "The shares must add up to 100%."}>
          <span className="text-sm tabular-nums">{Number.isFinite(sum) ? `${Math.round(sum * 10) / 10}%` : "-"}</span>
        </BudgetRow>
        <BudgetRow title="Weekly Limit" description={`A weekly limit on the features switched on below, as a share of their monthly amount.${total > 0 && week > 0 ? ` For example, Drafts get up to ${money((total * Number(shares.draft || 0) * week) / 10000)} a week.` : ""} Weeks start on Monday.`}>
          <div className="flex items-center gap-2">
            <Input aria-label="Weekly limit in percent of the monthly share" inputMode="decimal" className="w-20 text-right" value={weeklyPct} onChange={(e) => setWeeklyPct(e.target.value)} />
            <span className="text-sm text-muted-foreground">%</span>
          </div>
        </BudgetRow>
        {FEATURES.map((f) => (
          <BudgetRow key={`w-${f.key}`} title={`Weekly Limit on ${f.label}`}>
            <Switch aria-label={`Weekly limit on ${f.label}`} checked={weekly.includes(f.key)} onCheckedChange={(on) => setWeekly((w) => (on ? [...w, f.key] : w.filter((k) => k !== f.key)))} />
          </BudgetRow>
        ))}
        <BudgetRow title="Setup Allowance" description="For each newly connected account: the first sort, search index and learning. It is not counted in the week or the month. Sorting and learning only.">
          <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground">$</span>
            <Input aria-label="Setup allowance in dollars per account" inputMode="decimal" className="w-20 text-right" value={setupUsd} onChange={(e) => setSetupUsd(e.target.value)} />
          </div>
        </BudgetRow>
        <BudgetRow title="Setup Period" description="How long after connecting an account the setup allowance can be used.">
          <div className="flex items-center gap-2">
            <Input aria-label="Setup period in days" inputMode="numeric" className="w-20 text-right" value={setupDays} onChange={(e) => setSetupDays(e.target.value)} />
            <span className="text-sm text-muted-foreground">Days</span>
          </div>
        </BudgetRow>
        {LIMITS.map((x) => (
          <BudgetRow key={x.key} title={x.title} description={x.description}>
            <div className="flex items-center gap-2">
              <Input aria-label={x.title} inputMode={x.whole ? "numeric" : "decimal"} className="w-20 text-right" value={limits[x.key]} onChange={(e) => setLimits((l) => ({ ...l, [x.key]: e.target.value }))} />
              <span className="w-16 text-sm text-muted-foreground">{x.unit}</span>
            </div>
          </BudgetRow>
        ))}
      </div>
      <div className="flex justify-end px-3">
        <Button variant="secondary" disabled={!valid || !changed || busy} onClick={() => void save()}>Save</Button>
      </div>
    </div>
  );
}
