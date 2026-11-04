"use client";

// Admin's AI view, the budget: the most the AI may cost for each seat in a month (a team shares its seats times it), how it
// is divided between features (a feature pauses for a person once their share is spent, until the 1st; people see
// percentages only), weekly limits, the setup allowance and the abuse limits. One card per group and a sticky save bar.
// The page keeps it mounted so edits survive a view switch; the rules are in lib/admin-budget.ts.

import { useCallback, useEffect, useRef, useState } from "react";
import { CalendarClock, CircleDollarSign, Percent, ShieldAlert, Sparkles, Sigma } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/lib/supabase";
import { AI_FEATURES, PRICES_CHANGE, featureLabel, money } from "@/lib/ai-features";
import { LIMITS, badFields, budgetProblem, formSnapshot, mergeShares, sharesOf, shareTotal, unknownShares, zeroedFeatures, type BudgetForm, type LimitKey } from "@/lib/admin-budget";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { DIALOG_BUTTONS } from "@/components/merge-dialog";
import { Card, IconCircle, Row, Separated } from "@/components/surface";
import { when } from "./format";
import { Failed, LoadingCard } from "./parts";

const COLUMNS = "monthly_usd, shares, weekly_pct, weekly_features, setup_usd, setup_days, regen_per_hour, auto_drafts_per_day, summaries_per_day, flag_multiple, flag_day_usd, updated_at";

/** An h-8 number box with its unit; marked invalid when the form says so. */
function Field({ label, value, onChange, bad, before, after, numeric }: { label: string; value: string; onChange: (v: string) => void; bad: boolean; before?: string; after?: string; numeric?: boolean }) {
  return (
    <span className="flex items-center gap-2">
      {before && <span className="text-sm text-muted-foreground">{before}</span>}
      <Input aria-label={label} aria-invalid={bad || undefined} inputMode={numeric ? "numeric" : "decimal"} className="h-8 w-20 text-right" value={value} onChange={(e) => onChange(e.target.value)} />
      {after && <span className="text-sm text-muted-foreground">{after}</span>}
    </span>
  );
}

/** Reloads when `version` changes (the header Refresh), unless there are unsaved edits, which it keeps. */
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
    if (dirtyRef.current) toast("Unsaved Changes Kept. Discard Them To Load The Saved Budget.");
    else void load();
  }, [version, load]);

  if (failed) return <Failed title="Could Not Load The AI Budget" onRetry={() => void load()} />;
  if (!form) return <LoadingCard title="AI Budget" rows={3} />;

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
    if (error) return void toast.error(error.message || "Could Not Save The AI Budget");
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
      <Card title="AI Budget" action={<span className="shrink-0 text-xs text-muted-foreground">Saved {when(updatedAt)}</span>}>
        <Row
          lead={<IconCircle icon={CircleDollarSign} />}
          title="Monthly Budget Per Seat"
          detail={`Gemini Prices Change ${PRICES_CHANGE}`}
          end={<Field label="Monthly budget per seat in dollars" value={form.monthly} onChange={(monthly) => set({ monthly })} bad={bad.has("monthly")} before="$" />}
        />
      </Card>

      <Card title="Budget Split By Feature" action={<span className={sumOk ? "shrink-0 text-sm tabular-nums" : "shrink-0 text-sm tabular-nums text-destructive"}>{Number.isFinite(sum) ? `${Math.round(sum * 10) / 10}% Of 100%` : "Not A Number"}</span>}>
        <Separated>
          {AI_FEATURES.map((f) => (
            <Row
              key={f.key}
              lead={<IconCircle icon={Sparkles} />}
              title={f.label}
              meta={Number.isFinite(pct(f.key)) && total > 0 ? `Up To ${money((total * pct(f.key)) / 100)} A Month` : undefined}
              detail={<span title={f.note}>{f.note}</span>}
              end={
                <>
                  <Switch aria-label={`Weekly limit on ${f.label}`} checked={form.weekly.includes(f.key)} onCheckedChange={(on) => set({ weekly: on ? [...form.weekly, f.key] : form.weekly.filter((k) => k !== f.key) })} />
                  <Field label={`${f.label} share in percent`} value={form.shares[f.key]} onChange={(v) => set({ shares: { ...form.shares, [f.key]: v } })} bad={bad.has(`share:${f.key}`)} after="%" />
                </>
              }
            />
          ))}
          {extra.map(([key, value]) => (
            <Row key={key} lead={<IconCircle icon={Sigma} />} title={featureLabel(key)} detail="Set Outside This Page, Kept On Save" end={<span className="text-sm tabular-nums">{value}%</span>} />
          ))}
        </Separated>
      </Card>

      <Card title="Weekly Limit">
        <Row
          lead={<IconCircle icon={Percent} />}
          title="Of Each Switched On Share"
          detail={total > 0 && Number(form.weeklyPct) > 0 ? `Drafts Get Up To ${money((total * Number(form.shares.draft || 0) * Number(form.weeklyPct)) / 10000)} A Week` : "Weeks Start On Monday"}
          end={<Field label="Weekly limit in percent of the monthly share" value={form.weeklyPct} onChange={(weeklyPct) => set({ weeklyPct })} bad={bad.has("weeklyPct")} after="%" />}
        />
      </Card>

      <Card title="Setup">
        <Separated>
          <Row lead={<IconCircle icon={CircleDollarSign} />} title="Setup Allowance" detail="Per New Account" end={<Field label="Setup allowance in dollars per account" value={form.setupUsd} onChange={(setupUsd) => set({ setupUsd })} bad={bad.has("setupUsd")} before="$" />} />
          <Row lead={<IconCircle icon={CalendarClock} />} title="Setup Period" detail="After Connecting" end={<Field label="Setup period in days" value={form.setupDays} onChange={(setupDays) => set({ setupDays })} bad={bad.has("setupDays")} after="Days" numeric />} />
        </Separated>
      </Card>

      <Card title="Abuse Limits">
        <Separated>
          {LIMITS.map((x) => (
            <Row key={x.key} lead={<IconCircle icon={ShieldAlert} />} title={x.title} detail={x.description} end={<Field label={x.title} value={form.limits[x.key]} onChange={(v) => set({ limits: { ...form.limits, [x.key]: v } })} bad={bad.has(`limit:${x.key}`)} after={x.unit} numeric={x.whole} />} />
          ))}
        </Separated>
      </Card>

      <div className="sticky bottom-0 flex items-center gap-3 rounded-lg border bg-background p-2 pl-4">
        <span className={problem && changed ? "min-w-0 flex-1 truncate text-sm text-destructive" : "min-w-0 flex-1 truncate text-sm text-muted-foreground"}>{changed ? (problem ?? "Unsaved Changes") : "No Changes"}</span>
        <div className="flex shrink-0 gap-2">
          <Button variant="ghost" disabled={!changed || busy} onClick={() => void load()}>Discard</Button>
          <Button variant="secondary" disabled={!!problem || !changed || busy} onClick={askSave}>Save</Button>
        </div>
      </div>

      <AlertDialog open={!!confirm} onOpenChange={(open) => !open && setConfirm(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Pause {confirm?.map(featureLabel).join(" And ")}?</AlertDialogTitle>
            <AlertDialogDescription>A share of 0% stops {confirm && confirm.length > 1 ? "these features" : "this feature"} for everyone within a minute.</AlertDialogDescription>
          </AlertDialogHeader>
          <div className={DIALOG_BUTTONS}>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction variant="secondary" onClick={() => { setConfirm(null); void save(); }}>Save And Pause</AlertDialogAction>
          </div>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
