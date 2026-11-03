"use client";

// "Your Day": what the space beside the Summary shows with nothing open. The greeting, three numbers (replied today,
// waiting on others, promises), today's brief as text, and the week from the calendar as one row of seven days.
// Counts, titles and times only, apart from the brief, which is yours and sealed.

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { FIELD } from "@messages/crypto/fields";
import { useAuth } from "@/lib/auth";
import { useApp } from "@/lib/store";
import { supabase } from "@/lib/supabase";
import { open } from "@/lib/vault";
import { localDate } from "@/lib/brief";
import { dayKey, loadEvents, type CalendarEvent } from "@/lib/calendar";
import { promisesForSummary } from "@/lib/commitments";
import { timeOf } from "@/lib/format";
import { cn } from "@/lib/utils";
import { useSignInName } from "@/lib/onboarding";
import { greeting } from "@/lib/sent-days";
import { summarise } from "@/lib/summary";
import { useCommitments } from "@/components/commitments/use-commitments";
import { HomeCard, StatCard } from "@/components/inbox-home-parts";
import { useNow } from "@/components/summary/use-now";

/** The same slow clock as the Summary, so the two agree. */
const REFRESH_MS = 5 * 60_000;
/** Days in the week row, today first, and how many events each day shows before "+2". */
const WEEK_DAYS = 7;
const PER_DAY = 3;
const WEEKDAY = new Intl.DateTimeFormat("en-GB", { weekday: "short" });

/** Messages sent through Konva since midnight, or undefined while loading. */
function useRepliedToday(now: Date): number | undefined {
  const [count, setCount] = useState<number>();
  const day = dayKey(now);
  useEffect(() => {
    let cancelled = false;
    const [y, m, d] = day.split("-").map(Number);
    void supabase.from("outbox").select("id", { count: "exact", head: true }).eq("status", "sent").gte("sent_at", new Date(y, m - 1, d).toISOString())
      .then(({ count }) => { if (!cancelled) setCount(count ?? 0); });
    return () => { cancelled = true; };
  }, [day, now]);
  return count;
}

/** Today's brief as text, or null when there is none yet. */
function useBriefText(now: Date): string | null {
  const { session } = useAuth();
  const userId = session?.user.id;
  const [text, setText] = useState<string | null>(null);
  const day = localDate(now);
  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    void supabase.from("briefs").select("script").eq("for_date", day).eq("user_id", userId).maybeSingle()
      .then(async ({ data }) => {
        const script = data?.script ? await open(FIELD.brief, data.script) : null;
        if (!cancelled) setText(script?.trim() || null);
      });
    return () => { cancelled = true; };
  }, [userId, day, now]);
  return text;
}

/** Events from today to the end of the week row, soonest first. */
function useWeek(now: Date): CalendarEvent[] | undefined {
  const [events, setEvents] = useState<CalendarEvent[]>();
  const day = dayKey(now);
  useEffect(() => {
    let cancelled = false;
    const [y, m, d] = day.split("-").map(Number);
    const from = new Date(y, m - 1, d);
    const to = new Date(y, m - 1, d + WEEK_DAYS);
    loadEvents(from, to, { details: false })
      .then((all) => { if (!cancelled) setEvents(all.filter((e) => Date.parse(e.startsAt) >= from.getTime() && Date.parse(e.startsAt) < to.getTime()).sort((a, b) => a.startsAt.localeCompare(b.startsAt))); })
      .catch(() => { if (!cancelled) setEvents([]); });
    return () => { cancelled = true; };
  }, [day]);
  return events;
}

export function YourDay() {
  const { threads, loading, profile } = useApp();
  const signInName = useSignInName();
  const now = useNow(REFRESH_MS);
  const { all } = useCommitments();
  const replied = useRepliedToday(now);
  const brief = useBriefText(now);
  const week = useWeek(now);
  const waiting = useMemo(() => summarise(threads, "waiting", now).waiting.length, [threads, now]);
  const promises = useMemo(() => { const p = promisesForSummary(all, now); return p.yours.length + p.theirs.length; }, [all, now]);
  // Every day of the week, empty ones too, so the row always has its seven columns.
  const days = useMemo(() => Array.from({ length: WEEK_DAYS }, (_, i) => {
    const date = new Date(now.getFullYear(), now.getMonth(), now.getDate() + i);
    const day = dayKey(date);
    return { day, date, events: (week ?? []).filter((e) => dayKey(new Date(e.startsAt)) === day) };
  }), [week, now]);
  return (
    // Centred while it fits, scrolling from the top once it does not.
    <div className="h-full overflow-y-auto">
      <div className="flex min-h-full justify-center p-3 md:p-6">
        <div className="my-auto flex w-full max-w-2xl flex-col gap-3">
          <h1 className="pb-3 text-2xl font-medium">{greeting(new Date(), profile.name || signInName)}</h1>
          <div className="grid grid-cols-3 gap-3">
            <StatCard label="Replied Today" value={replied} />
            <StatCard label="Waiting On Others" value={loading ? undefined : waiting} />
            <StatCard label="Promises" value={promises} />
          </div>
          {brief && (
            <HomeCard title="Today's Brief">
              <p className="px-3 pb-3 text-sm leading-6 whitespace-pre-line">{brief}</p>
            </HomeCard>
          )}
          <HomeCard title="This Week" href="/calendar">
            <div className="grid grid-cols-7 gap-1 px-1 pb-1">
              {days.map((d, i) => (
                <div key={d.day} className="flex min-w-0 flex-col gap-1">
                  <Link href={`/calendar?date=${d.day}`} className={cn("flex flex-col items-center rounded-lg py-1.5 outline-none hover:bg-muted/50 focus-visible:ring-2 focus-visible:ring-ring/50", i === 0 && "bg-muted")}>
                    <span className="text-xs text-muted-foreground">{WEEKDAY.format(d.date)}</span>
                    <span className="text-sm font-medium tabular-nums">{d.date.getDate()}</span>
                  </Link>
                  {d.events.slice(0, PER_DAY).map((e) => (
                    <Link key={e.id} href={`/calendar?date=${d.day}&event=${encodeURIComponent(e.id)}`} title={e.title} className="flex min-w-0 flex-col rounded-md bg-muted/50 px-1.5 py-1 text-xs outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring/50">
                      <span className="tabular-nums text-muted-foreground">{e.allDay ? "All Day" : timeOf(e.startsAt)}</span>
                      <span className="truncate">{e.title}</span>
                    </Link>
                  ))}
                  {d.events.length > PER_DAY && <span className="px-1.5 text-xs text-muted-foreground">+{d.events.length - PER_DAY}</span>}
                </div>
              ))}
            </div>
          </HomeCard>
        </div>
      </div>
    </div>
  );
}
