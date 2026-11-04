// The shared company logos, for the owner's review page. One logo per company domain, found and judged by
// the workers (supabase/migrations/20261031100000_company_logos.sql); the database lets only the owner read
// the rows, the candidates and the judge's sheets, and only the owner run the two actions here.

import { supabase } from "./supabase";

export type LogoSource = "app_store" | "bimi" | "site" | "google" | "wikidata" | "simple_icons" | "search";

export const SOURCE_LABELS: Record<LogoSource, string> = {
  app_store: "App Store",
  bimi: "BIMI",
  site: "Website",
  google: "Google",
  wikidata: "Wikidata",
  simple_icons: "Simple Icons",
  search: "Google Search",
};

export interface LogoCandidate {
  n: number;
  source: LogoSource;
  url: string;
  path: string;
  note?: string;
  fit: "mark" | "tile" | "inset";
  quality: number;
}

export interface TurnedDown {
  n: number;
  source: LogoSource | null;
  url: string | null;
  /** The framed candidate, under review/ in the "logos" bucket. */
  path?: string | null;
  reason: string;
}

export interface CompanyLogo {
  domain: string;
  name: string;
  status: "queued" | "judging" | "judged" | "searching" | "done";
  round: number;
  candidates: LogoCandidate[];
  pick: number | null;
  rejected: TurnedDown[];
  verdict: string | null;
  manual: boolean;
  source: LogoSource | null;
  url: string | null;
  /** The chosen logo (logo-paths.ts says which bucket), or null when the building icon shows. */
  path: string | null;
  changedAt: string | null;
  checkedAt: string | null;
  geminiCalls: number;
  geminiCostUsd: number;
}

export async function loadCompanyLogos(): Promise<CompanyLogo[]> {
  const { data, error } = await supabase
    .from("company_logos")
    .select("domain, name, status, round, candidates, pick, rejected, verdict, manual, source, url, path, changed_at, checked_at, gemini_calls, gemini_cost_usd")
    .order("name");
  if (error) throw new Error("Could not load the company logos.");
  return data.map((r) => ({
    domain: r.domain,
    name: r.name,
    status: r.status as CompanyLogo["status"],
    round: r.round,
    candidates: (r.candidates as unknown as LogoCandidate[]) ?? [],
    pick: r.pick,
    rejected: (r.rejected as unknown as TurnedDown[]) ?? [],
    verdict: r.verdict,
    manual: r.manual,
    source: r.source as LogoSource | null,
    url: r.url,
    path: r.path,
    changedAt: r.changed_at,
    checkedAt: r.checked_at,
    geminiCalls: r.gemini_calls,
    geminiCostUsd: Number(r.gemini_cost_usd),
  }));
}

/** Turns down a candidate (the chosen logo when n is null) and looks again without it, for every user. */
export async function rejectLogo(domain: string, n: number | null): Promise<void> {
  const { error } = await supabase.rpc("company_logo_reject", n === null ? { p_domain: domain } : { p_domain: domain, p_n: n });
  if (error) throw new Error("Could not reject the logo.");
}

/** Chooses one of the latest candidates by hand, for every user. */
export async function chooseLogo(domain: string, n: number): Promise<void> {
  const { error } = await supabase.rpc("company_logo_choose", { p_domain: domain, p_n: n });
  if (error) throw new Error("Could not choose the logo.");
}
