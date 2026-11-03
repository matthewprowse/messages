"use client";

// What the Conversations page shows with nothing open: a greeting, what is waiting (unread, and what needs you), the rest
// of today's calendar, the top of the Summary (Needs Reply and Important), and a heatmap of the messages you sent through
// Konva each day (counts only). Hidden on a phone, where the list is the page.

import { useEffect, useMemo, useState } from "react";
import { useApp } from "@/lib/store";
import { dayKey } from "@/lib/calendar";
import { summarise } from "@/lib/summary";
import { supabase } from "@/lib/supabase";
import { inboxCounts } from "@/lib/thread-list";
import { greeting, gridStart, sentTotal, sentWeeks, type SentDay } from "@/lib/sent-days";
import { useSignInName } from "@/lib/onboarding";
import { cn } from "@/lib/utils";
import { EventRow } from "@/components/summary/event-row";
import { useNow } from "@/components/summary/use-now";
import { useTodaysEvents } from "@/components/summary/use-todays-events";
import { ConversationLink, HomeCard, StatCard } from "@/components/inbox-home-parts";

const WEEKS = 26;
/** Rows per card: a glance, with See All for the rest. */
const SHOWN = 3;
/** The same slow clock as the Summary, so the two agree on what is still today and still waiting. */
const REFRESH_MS = 5 * 60_000;
const SHADE: Record<SentDay["level"], string> = { 0: "bg-muted", 1: "bg-foreground/20", 2: "bg-foreground/40", 3: "bg-foreground/65", 4: "bg-foreground" };
const DAY = new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", month: "short" });

/** When each of your sent messages in the heatmap's weeks went out, or null while loading. */
function useSentTimes(): string[] | null {
  const [times, setTimes] = useState<string[] | null>(null);
  useEffect(() => {
    let cancelled = false;
    const since = gridStart(new Date(), WEEKS).toISOString();
    void supabase.from("outbox").select("sent_at").eq("status", "sent").gte("sent_at", since).limit(20000)
      .then(({ data }) => { if (!cancelled) setTimes((data ?? []).flatMap((r) => (r.sent_at ? [r.sent_at] : []))); });
    return () => { cancelled = true; };
  }, []);
  return times;
}

export function InboxHome() {
  const { threads, loading, profile } = useApp();
  const signInName = useSignInName();
  const { unread, attention } = inboxCounts(threads);
  const now = useNow(REFRESH_MS);
  const { events } = useTodaysEvents(now);
  const sections = useMemo(() => summarise(threads, "none", now), [threads, now]);
  const times = useSentTimes();
  const weeks = useMemo(() => sentWeeks(times ?? [], new Date(), WEEKS), [times]);
  const total = sentTotal(weeks);
  return (
    // Centred while it fits, scrolling from the top once it does not.
    <div className="h-full overflow-y-auto">
      <div className="flex min-h-full justify-center p-3 md:p-6">
        <div className="my-auto flex w-full max-w-2xl flex-col gap-3">
          <h1 className="pb-3 text-2xl font-medium">{greeting(new Date(), profile.name || signInName)}</h1>
          <div className="grid grid-cols-2 gap-3">
            <StatCard label="Unread" value={loading ? undefined : unread} />
            <StatCard label="Need You" value={loading ? undefined : attention} />
          </div>
          {events && events.length > 0 && (
            <HomeCard title="Today" href="/calendar">
              {events.slice(0, SHOWN).map((e) => <EventRow key={e.id} event={e} today={dayKey(now)} />)}
            </HomeCard>
          )}
          {sections.reply.length > 0 && (
            <HomeCard title="Needs Reply" href="/summary">
              {sections.reply.slice(0, SHOWN).map((t) => <ConversationLink key={t.id} thread={t} />)}
            </HomeCard>
          )}
          {sections.priority.length > 0 && (
            <HomeCard title="Important" href="/summary">
              {sections.priority.slice(0, SHOWN).map((t) => <ConversationLink key={t.id} thread={t} />)}
            </HomeCard>
          )}
          <section aria-label="Sent With Konva" className="flex flex-col gap-4 rounded-lg border bg-background p-4">
            <div className="flex items-baseline justify-between gap-3">
              <h2 className="text-sm text-muted-foreground">Sent With Konva</h2>
              <span className="text-sm tabular-nums text-muted-foreground">{times ? `${total} in ${WEEKS} Weeks` : ""}</span>
            </div>
            {/* The weeks share the card's width, so the squares grow and shrink with it. */}
            <div className="flex gap-1" role="img" aria-label={`${total} messages sent in the last ${WEEKS} weeks`}>
              {weeks.map((week) => (
                <div key={week[0].date} className="flex min-w-0 flex-1 flex-col gap-1">
                  {week.map((d) => (
                    <div
                      key={d.date}
                      title={d.future ? undefined : `${d.count} Sent, ${DAY.format(new Date(`${d.date}T12:00:00`))}`}
                      className={cn("aspect-square w-full rounded-[3px]", d.future ? "bg-transparent" : SHADE[d.level])}
                    />
                  ))}
                </div>
              ))}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
