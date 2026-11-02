// What a person has used against each of their limits (the AI allowance for the week and the month, and storage), for
// Settings, Usage and the ring at the bottom of the navigation rail. Plain functions, so the sums are tested apart from Supabase.

/** What my_ai_allowance returns: percentages only, never dollars. */
export type Allowance = { used_pct: number; resets_at: string; features: Record<string, number>; week_pct: number | null; week_resets_at: string; week_features: Record<string, number> };

/** Stored bytes against the cap: your own, or your team's pooled total when you are in one. */
export type StorageUse = { held: number; cap: number; team: boolean };

// In the order shown. A feature that is not in the budget is not listed.
export const FEATURE_LABEL: Record<string, string> = { triage: "Sorting and Junk", draft: "Drafts", learn: "Learning From Edits", brief: "Daily Brief", transcribe: "Transcripts", bulk_read: "Readable Bulk Email" };

export const clampPct = (n: number) => Math.max(0, Math.min(100, Number.isFinite(n) ? n : 0));
export const pctLabel = (n: number) => `${Math.round(clampPct(n))}%`;
export const resetsLabel = (iso: string) => new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "long" });

/** True when the allowance has a weekly limit that covers at least one feature. */
export const hasWeek = (a: Allowance) => a.week_pct !== null && Object.keys(a.week_features).length > 0;

export type Limit = { key: "week" | "month" | "storage"; label: string; pct: number; resetsAt?: string };

/** Every limit that applies, in the order shown: AI this week (when there is a weekly limit), AI this month, then storage. */
export function limitsOf(allowance: Allowance | null, storage: StorageUse | null): Limit[] {
  const out: Limit[] = [];
  if (allowance && hasWeek(allowance)) out.push({ key: "week", label: "AI This Week", pct: clampPct(allowance.week_pct ?? 0), resetsAt: allowance.week_resets_at });
  if (allowance) out.push({ key: "month", label: "AI This Month", pct: clampPct(allowance.used_pct), resetsAt: allowance.resets_at });
  if (storage) out.push({ key: "storage", label: storage.team ? "Team Storage" : "Storage", pct: clampPct(storage.cap > 0 ? (storage.held / storage.cap) * 100 : 0) });
  return out;
}

/** The limit closest to running out, which is what the ring shows: the first to pause something is the one worth seeing. */
export function closestLimit(limits: Limit[]): Limit | null {
  return limits.reduce<Limit | null>((best, l) => (!best || l.pct > best.pct ? l : best), null);
}

export type FeatureUse = { feature: string; label: string; pct: number; pausedUntil: string | null };

/** Each AI feature's share used this month, and when it starts again if its week or month is used up. */
export function featuresOf(a: Allowance): FeatureUse[] {
  return Object.keys(FEATURE_LABEL).filter((f) => f in a.features).map((f) => {
    const month = a.features[f] ?? 0;
    const week = a.week_features[f] ?? 0;
    // Paused by its week or its month, whichever is used up; the month wins when both are, since it resets later.
    const pausedUntil = month >= 100 ? a.resets_at : week >= 100 ? a.week_resets_at : null;
    return { feature: f, label: FEATURE_LABEL[f], pct: clampPct(month), pausedUntil };
  });
}
