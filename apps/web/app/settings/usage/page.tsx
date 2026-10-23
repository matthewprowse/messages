"use client";

import { useEffect, useState } from "react";
import type { Tables } from "@messages/db";
import { useApp } from "@/lib/store";
import { supabase } from "@/lib/supabase";
import { providerLabel } from "@/components/primitives";
import { Skeleton } from "@/components/ui/skeleton";
import { SettingsHeader } from "@/components/settings-header";
import { SettingsRow, SettingsRows, SettingsSection } from "@/components/settings/sections";

type SummaryRow = Tables<"ai_usage_summary">;

const FEATURE_LABEL: Record<string, string> = { triage: "Sorting and Junk", draft: "Drafts", learn: "Learning From Edits", brief: "Daily Brief" };
const REFRESH_MS = 30_000;

function money(usd: number) {
  if (usd === 0) return "$0.00";
  return usd < 1 ? `$${usd.toFixed(4)}` : `$${usd.toFixed(2)}`;
}

const calls = (n: number) => (n === 1 ? "1 call" : `${n} calls`);

function tokens(n: number) {
  return n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 1000 ? `${Math.round(n / 1000)}K` : String(n);
}

function Amount({ value, label }: { value: string; label?: string }) {
  return (
    <div className="text-right text-sm tabular-nums">
      {value}
      {label && <div className="text-xs text-muted-foreground">{label}</div>}
    </div>
  );
}

export default function UsagePage() {
  const { accounts } = useApp();
  const [rows, setRows] = useState<SummaryRow[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = () =>
      supabase
        .from("ai_usage_summary")
        .select("*")
        .then(({ data }) => { if (!cancelled) setRows(data ?? []); });
    load();
    const timer = setInterval(load, REFRESH_MS);
    return () => { cancelled = true; clearInterval(timer); };
  }, []);

  // Months are grouped in UTC by the database.
  const now = new Date();
  const thisMonth = (r: SummaryRow) =>
    !!r.month && new Date(r.month).getUTCFullYear() === now.getUTCFullYear() && new Date(r.month).getUTCMonth() === now.getUTCMonth();
  const sum = (list: SummaryRow[], key: "cost_usd" | "calls" | "input_tokens" | "output_tokens") => list.reduce((n, r) => n + Number(r[key] ?? 0), 0);

  const accountIds = [...new Set([...accounts.map((a) => a.id), ...(rows ?? []).map((r) => r.account_id ?? "none")])];
  const features = ["triage", "draft", "learn", "brief"];
  const month = (rows ?? []).filter(thisMonth);

  return (
    <>
      <SettingsHeader title="Usage" description="What the AI has cost, per connected account, in US dollars at Google's published Gemini prices." />
      {rows === null ? (
        <Skeleton className="h-40 w-full rounded-lg" />
      ) : (
        <div className="space-y-8">
          <SettingsSection id="accounts" title="Accounts">
            <SettingsRows>
              {accountIds.map((id) => {
                const account = accounts.find((a) => a.id === id);
                const all = rows.filter((r) => (r.account_id ?? "none") === id);
                return (
                  <SettingsRow
                    key={id}
                    title={account ? `${providerLabel[account.provider]}, ${account.detail}` : "Not Linked to an Account"}
                    description={`${calls(sum(all, "calls"))} in total, ${money(sum(all, "cost_usd"))} all time`}
                  >
                    <Amount value={money(sum(all.filter(thisMonth), "cost_usd"))} label="This Month" />
                  </SettingsRow>
                );
              })}
              <SettingsRow title="Total" description={`${money(sum(rows, "cost_usd"))} all time`}>
                <Amount value={money(sum(month, "cost_usd"))} label="This Month" />
              </SettingsRow>
            </SettingsRows>
          </SettingsSection>

          <SettingsSection id="features" title="This Month by Feature">
            <SettingsRows>
              {features.map((f) => {
                const list = month.filter((r) => r.feature === f);
                const models = [...new Set(list.map((r) => r.model))].join(", ");
                return (
                  <SettingsRow
                    key={f}
                    title={FEATURE_LABEL[f]}
                    description={`${calls(sum(list, "calls"))}, ${tokens(sum(list, "input_tokens"))} in, ${tokens(sum(list, "output_tokens"))} out${models ? `, ${models}` : ""}`}
                  >
                    <Amount value={money(sum(list, "cost_usd"))} />
                  </SettingsRow>
                );
              })}
            </SettingsRows>
          </SettingsSection>
        </div>
      )}
    </>
  );
}
