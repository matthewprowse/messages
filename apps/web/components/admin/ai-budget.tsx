"use client";

// Admin view for the monthly AI budget: how it is shared between features, weekly limits, the setup allowance and the abuse
// limits. Reads and saves through Supabase. The page keeps it mounted so edits survive a tab switch; the rules (what is
// invalid, which keys a save keeps, what would pause a feature) are in lib/admin-budget.ts.

import { useCallback, useEffect, useRef, useState } from "react";
import { Wallet } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/lib/supabase";
import { AI_FEATURES, PRICES_CHANGE, PRICES_CHECKED, featureLabel, money } from "@/lib/ai-features";
import { LIMITS, badFields, budgetProblem, formSnapshot, mergeShares, sharesOf, shareTotal, unknownShares, zeroedFeatures, type BudgetForm, type LimitKey } from "@/lib/admin-budget";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/primitives";
import { AdminHeading, AdminRow } from "@/components/admin/parts";

const COLUMNS = "monthly_usd, shares, weekly_pct, weekly_features, setup_usd, setup_days, regen_per_hour, auto_drafts_per_day, summaries_per_day, flag_multiple, flag_day_usd, updated_at";

/** A number box with its unit; marked invalid when the form says so. */
function Field({ label, value, onChange, bad, before, after, wide, numeric }: { label: string; value: string; onChange: (v: string) => void; bad: boolean; before?: string; after?: string; wide?: boolean; numeric?: boolean }) {
  return (
    <div className="flex items-center gap-2">
      {before && <span className="text-sm text-muted-foreground">{before}</span>}
      <Input aria-label={label} aria-invalid={bad || undefined} inputMode={numeric ? "numeric" : "decimal"} className={wide ? "w-24 text-right" : "w-20 text-right"} value={value} onChange={(e) => onChange(e.target.value)} />
      {after && <span className="text-sm text-muted-foreground">{after}</span>}
    </div>
  );
}

/**
 * The most the AI may cost for each seat in a month, and how it is divided between features. A team shares its seats times this amount. A feature
 * pauses for a person when their share of it is spent, until the 1st. People are shown percentages only.
 */
export function AiBudget({ version, onBusy }: { version: number; onBusy: (busy: boolean) => void }) {
  const [form, setForm] = useState<BudgetForm | null>(null);
  const [original, setOriginal] = useState<Record<string, number>>({});
  const [saved, setSaved] = useState("");
  const [updatedAt, setUpdatedAt] = useState("");
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState<string[] | null>(null);
  const dirtyRef = useRef(false);
  const seen = useRef(version);

  const load = useCallback(async () => {
    onBusy(true);
    const { data, error } = await supabase.from("ai_budget").select(COLUMNS).maybeSingle();
    onBusy(false);
    if (error || !data) return setFailed(true);
    setFailed(false);
    const s = sharesOf(data.shares);
    const next: BudgetForm = {
      monthly: String(data.monthly_usd),
      shares: Object.fromEntries(AI_FEATURES.map((f) => [f.key, String(s[f.key] ?? 0)])),
      weeklyPct: String(data.weekly_pct),
      weekly: data.weekly_features,
      setupUsd: String(data.setup_usd),
      setupDays: String(data.setup_days),
      limits: Object.fromEntries(LIMITS.map((x) => [x.key, String(data[x.key])])) as Record<LimitKey, string>,
    };
    setOriginal(s);
    setForm(next);
    setSaved(formSnapshot(next));
    setUpdatedAt(data.updated_at);
  }, [onBusy]);

  useEffect(() => { void load(); }, [load]);
  // The header Refresh: reloading would throw away edits, so it only reloads a form with none.
  useEffect(() => {
    if (version === seen.current) return;
    seen.current = version;
    if (dirtyRef.current) toast("Unsaved changes kept. Discard them to load the saved budget.");
    else void load();
  }, [version, load]);

  if (failed) return <EmptyState icon={Wallet} title="Could Not Load the AI Budget" description="Check your connection and refresh." />;
  if (!form) return <Skeleton className="h-40 w-full rounded-lg" />;

  const set = (patch: Partial<BudgetForm>) => setForm((f) => (f ? { ...f, ...patch } : f));
  const bad = badFields(form);
  const problem = budgetProblem(form, original);
  const changed = formSnapshot(form) !== saved;
  dirtyRef.current = changed;
  const total = Number(form.monthly);
  const sum = shareTotal(form, original);
  const sumOk = Math.round(sum * 100) === 10000;
  const extra = Object.entries(unknownShares(original));
  const edited = () => Object.fromEntries(AI_FEATURES.map((f) => [f.key, Number(form.shares[f.key])]));

  const save = async () => {
    setBusy(true);
    const shares = mergeShares(original, edited());
    // updated_at in the filter: a save from a stale tab matches nothing instead of overwriting a newer budget.
    const { data, error } = await supabase.from("ai_budget").update({
      monthly_usd: total, shares, weekly_pct: Number(form.weeklyPct), weekly_features: form.weekly, setup_usd: Number(form.setupUsd), setup_days: Number(form.setupDays),
      ...Object.fromEntries(LIMITS.map((x) => [x.key, Number(form.limits[x.key])])), updated_at: new Date().toISOString(),
    }).eq("id", true).eq("updated_at", updatedAt).select("updated_at");
    setBusy(false);
    if (error) return void toast.error(error.message || "Could Not Save the AI Budget");
    if (!data?.length) return void toast.error("The AI Budget Changed Elsewhere. Discard your edits to load it, then try again.");
    setOriginal(shares);
    setSaved(formSnapshot(form));
    setUpdatedAt(data[0].updated_at);
    toast("AI Budget Saved");
  };
  const askSave = () => {
    const zero = zeroedFeatures(original, edited());
    if (zero.length > 0) setConfirm(zero);
    else void save();
  };

  const pct = (key: string) => Number(form.shares[key]);
  return (
    <div className="flex flex-col gap-3">
      <AdminHeading
        title="AI Budget"
        description={`The most the AI may cost for each seat in a month, and how it is divided between features. A team shares its seats times this amount. A feature pauses for a person once their share is spent, until the 1st. People see percentages only, never dollars. Changes apply within a minute. Last saved ${new Date(updatedAt).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}.`}
      />
      <AdminRow title="Monthly Budget per Seat" description={`In US dollars, at Google's Gemini prices checked on ${PRICES_CHECKED}. They change on ${PRICES_CHANGE}, so review the shares then.`}>
        <Field label="Monthly budget per seat in dollars" value={form.monthly} onChange={(monthly) => set({ monthly })} bad={bad.has("monthly")} before="$" wide />
      </AdminRow>

      <AdminHeading title="Monthly Shares" description="Each feature's share of the monthly budget, and whether it also has a weekly limit. A share of 0% pauses the feature for everyone." />
      <div>
        {AI_FEATURES.map((f) => (
          <AdminRow key={f.key} title={f.label} description={`${f.note}${Number.isFinite(pct(f.key)) && total > 0 ? ` Up to ${money((total * pct(f.key)) / 100)} a month.` : ""}`}>
            <label className="flex items-center gap-2 text-xs text-muted-foreground">
              Weekly
              <Switch aria-label={`Weekly limit on ${f.label}`} checked={form.weekly.includes(f.key)} onCheckedChange={(on) => set({ weekly: on ? [...form.weekly, f.key] : form.weekly.filter((k) => k !== f.key) })} />
            </label>
            <Field label={`${f.label} share in percent`} value={form.shares[f.key]} onChange={(v) => set({ shares: { ...form.shares, [f.key]: v } })} bad={bad.has(`share:${f.key}`)} after="%" />
          </AdminRow>
        ))}
        {extra.map(([key, value]) => (
          <AdminRow key={key} title={featureLabel(key)} description="Set outside this page. It is kept as it is when you save, and counts toward the total.">
            <span className="text-sm tabular-nums">{value}%</span>
          </AdminRow>
        ))}
        <AdminRow title="Total" description={sumOk ? undefined : <span className="text-destructive">Must Add Up to 100%.</span>}>
          <span className={sumOk ? "text-sm tabular-nums" : "text-sm tabular-nums text-destructive"}>{Number.isFinite(sum) ? `${Math.round(sum * 10) / 10}%` : "Not a Number"}</span>
        </AdminRow>
      </div>

      <AdminHeading title="Weekly Limit" description="Applies to the features switched on above. Weeks start on Monday." />
      <AdminRow title="Weekly Limit" description={`A share of each switched-on feature's monthly amount.${total > 0 && Number(form.weeklyPct) > 0 ? ` For example, Drafts get up to ${money((total * Number(form.shares.draft || 0) * Number(form.weeklyPct)) / 10000)} a week.` : ""}`}>
        <Field label="Weekly limit in percent of the monthly share" value={form.weeklyPct} onChange={(weeklyPct) => set({ weeklyPct })} bad={bad.has("weeklyPct")} after="%" />
      </AdminRow>

      <AdminHeading title="Setup" description="For each newly connected account: the first sort, search index and learning. It is not counted in the week or the month. Sorting and learning only." />
      <AdminRow title="Setup Allowance" description="Dollars each new account gets.">
        <Field label="Setup allowance in dollars per account" value={form.setupUsd} onChange={(setupUsd) => set({ setupUsd })} bad={bad.has("setupUsd")} before="$" />
      </AdminRow>
      <AdminRow title="Setup Period" description="How long after connecting an account the setup allowance can be used.">
        <Field label="Setup period in days" value={form.setupDays} onChange={(setupDays) => set({ setupDays })} bad={bad.has("setupDays")} after="Days" numeric />
      </AdminRow>

      <AdminHeading title="Abuse Limits" />
      <div>
        {LIMITS.map((x) => (
          <AdminRow key={x.key} title={x.title} description={x.description}>
            <Field label={x.title} value={form.limits[x.key]} onChange={(v) => set({ limits: { ...form.limits, [x.key]: v } })} bad={bad.has(`limit:${x.key}`)} after={x.unit} numeric={x.whole} />
          </AdminRow>
        ))}
      </div>

      <div className="sticky bottom-0 flex flex-wrap items-center justify-end gap-3 border-t bg-background px-3 py-2">
        {changed && <span className="mr-auto text-xs text-muted-foreground">{problem ?? "Unsaved Changes"}</span>}
        {changed && <Button variant="ghost" disabled={busy} onClick={() => void load()}>Discard</Button>}
        <Button variant="secondary" disabled={!!problem || !changed || busy} onClick={askSave}>Save</Button>
      </div>

      <AlertDialog open={!!confirm} onOpenChange={(open) => !open && setConfirm(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Pause {confirm?.map(featureLabel).join(" and ")}?</AlertDialogTitle>
            <AlertDialogDescription>A share of 0% stops {confirm && confirm.length > 1 ? "these features" : "this feature"} for everyone within a minute, until the share is raised again.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction variant="secondary" onClick={() => { setConfirm(null); void save(); }}>Save and Pause</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
