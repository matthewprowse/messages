"use client";

import { useCallback, useEffect, useState } from "react";
import { supabase } from "./supabase";
import { useAuth } from "./auth";

// Cover, from the app's side (supabase/migrations/20261104100000_team_after_launch.sql). While a period is in force the covering
// member reads the absent member's work chats as if they were assigned, and answers from their own account. It ends by itself
// when its end passes (the database compares it with the clock, so nothing runs and nothing can be forgotten) or when someone
// ends it early. Replying from the absent member's own number is not built.

const problem = (error: { message: string } | null) => error?.message || "Something went wrong. Try again.";

export type CoverState = "upcoming" | "active" | "ended" | "ended_early";

export interface CoverPeriod {
  id: string;
  absentId: string;
  coverId: string;
  startsAt: string;
  /** The first instant the cover no longer applies. The last day shown is the day before the end, in the person's own time. */
  endsAt: string;
  endedAt: string | null;
}

export function coverState(p: CoverPeriod, now = Date.now()): CoverState {
  if (p.endedAt) return "ended_early";
  if (now >= new Date(p.endsAt).getTime()) return "ended";
  return now < new Date(p.startsAt).getTime() ? "upcoming" : "active";
}

/** The last day of a period, as a Date at noon, so it formats as that day in any time zone. */
export function lastDay(p: CoverPeriod): Date {
  const end = new Date(p.endedAt && new Date(p.endedAt) < new Date(p.endsAt) ? p.endedAt : p.endsAt);
  const day = new Date(end.getTime() - 1);
  return new Date(day.getFullYear(), day.getMonth(), day.getDate(), 12);
}

/** A date input's value (yyyy-mm-dd) as the start of that day in the person's own time zone. */
export const startOfDay = (value: string) => new Date(`${value}T00:00:00`);
/** And the instant after its last moment: the end of a period that runs through that day. */
export const endOfDay = (value: string) => { const d = startOfDay(value); d.setDate(d.getDate() + 1); return d; };

/** The cover periods the signed-in person may see: their own as the absent or the covering person, and for an owner or admin all of them. */
export function useCover() {
  const { session } = useAuth();
  const userId = session?.user.id;
  const [periods, setPeriods] = useState<CoverPeriod[] | null | undefined>(undefined);
  const load = useCallback(async () => {
    if (!userId) return;
    const { data, error } = await supabase.from("workspace_cover").select("id, absent_id, cover_id, starts_at, ends_at, ended_at").order("starts_at", { ascending: false });
    if (error) return setPeriods(null);
    setPeriods((data ?? []).map((r): CoverPeriod => ({ id: r.id, absentId: r.absent_id, coverId: r.cover_id, startsAt: r.starts_at, endsAt: r.ends_at, endedAt: r.ended_at })));
  }, [userId]);
  useEffect(() => { void load(); }, [load]);
  return { periods, reload: load };
}

/** Sets cover from the first date through the last date, inclusive. Returns a reason on failure, null when it worked. */
export async function setCover(absentId: string, coverId: string, from: string, through: string): Promise<string | null> {
  const { error } = await supabase.rpc("set_cover", { p_absent: absentId, p_cover: coverId, p_starts: startOfDay(from).toISOString(), p_ends: endOfDay(through).toISOString() });
  return error ? problem(error) : null;
}

export async function endCover(id: string): Promise<string | null> {
  const { error } = await supabase.rpc("end_cover", { p_id: id });
  return error ? problem(error) : null;
}
