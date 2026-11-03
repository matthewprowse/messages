// Which Admin view, period and filter an address asks for, and where the old Analytics addresses (/analytics?tab=...,
// /analytics/logos) land now that Analytics is part of Admin. Pure: the page and the redirects read it, the tests pin it.

/** The periods Usage and AI can show, in days, and the one they open on. */
export const RANGES = [7, 14, 30, 90] as const;
export type Days = (typeof RANGES)[number];
export const DEFAULT_DAYS: Days = 30;

export const VIEWS = ["overview", "usage", "ai", "system", "flags", "teams", "audit", "logos"] as const;
export type AdminView = (typeof VIEWS)[number];

/** The old Analytics tabs, and what each became. */
const OLD_TABS: Record<string, AdminView> = { health: "overview", usage: "usage", ai: "ai" };

export interface AdminParams {
  view: AdminView;
  days: Days;
  exclude: boolean;
}

/** The view, period and owner switch from an address's query. Anything unknown falls back to Overview, 30 days, off. */
export function readAdminParams(params: URLSearchParams): AdminParams {
  const asked = params.get("view") ?? "";
  const tab = OLD_TABS[params.get("tab") ?? ""];
  const view: AdminView = (VIEWS as readonly string[]).includes(asked) ? (asked as AdminView) : (tab ?? "overview");
  const days = Number(params.get("days"));
  return { view, days: (RANGES as readonly number[]).includes(days) ? (days as Days) : DEFAULT_DAYS, exclude: params.get("exclude") === "1" };
}

/** The Admin address for an old Analytics one: its tab becomes the view, the period and switch carry over. */
export function adminHrefFromAnalytics(params: URLSearchParams, view?: AdminView): string {
  const { view: mapped, days, exclude } = readAdminParams(params);
  const next = new URLSearchParams({ view: view ?? mapped });
  if (days !== DEFAULT_DAYS) next.set("days", String(days));
  if (exclude) next.set("exclude", "1");
  return `/admin?${next.toString()}`;
}
