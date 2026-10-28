"use client";

// Owner-only team activity in Settings, Team: response times per person and how many chats were moved back to personal.
// Counts only, never the chats themselves.

import { useState } from "react";
import { replyTime, type ResponseStat, type WeekCount } from "@/lib/team-work";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ROLE_LABEL, type TeamRole } from "@/lib/team";
import { SettingsEmpty, SettingsRow, SettingsRows, SettingsSection } from "@/components/settings/sections";

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** The Monday of a week, as the owner reads it. */
function weekLabel(week: string): string {
  const monday = new Date(`${week}T00:00:00Z`);
  const thisMonday = new Date();
  thisMonday.setUTCHours(0, 0, 0, 0);
  thisMonday.setUTCDate(thisMonday.getUTCDate() - ((thisMonday.getUTCDay() + 6) % 7));
  const weeksAgo = Math.round((thisMonday.getTime() - monday.getTime()) / (7 * 86_400_000));
  if (weeksAgo <= 0) return "This Week";
  if (weeksAgo === 1) return "Last Week";
  return `Week of ${monday.toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" })}`;
}

function PersonRow({ s, days }: { s: ResponseStat; days: 7 | 30 }) {
  const unanswered = days === 7 ? s.unanswered7 : s.unanswered30;
  const answered = days === 7 ? s.answered7 : s.answered30;
  const median = days === 7 ? s.median7 : s.median30;
  return (
    <SettingsRow
      title={
        <>
          {s.name}
          {s.role && <Badge variant="outline">{ROLE_LABEL[s.role as TeamRole] ?? s.role}</Badge>}
          {s.userId && !s.active && <Badge variant="destructive">Has Left</Badge>}
          {!s.userId && <Badge variant="outline">Shared Inboxes</Badge>}
        </>
      }
      description={
        s.userId ? `${plural(answered, "client message")} answered in the last ${days} days.` : `Shared inbox chats nobody is assigned to, waiting in the last ${days} days.`
      }
    >
      <div className="flex gap-6 text-right text-xs">
        <div>
          <div className={unanswered > 0 ? "text-sm font-medium" : "text-sm text-muted-foreground"}>{unanswered}</div>
          <div className="text-muted-foreground">Unanswered</div>
        </div>
        <div className="min-w-24">
          <div className={median === null ? "text-sm text-muted-foreground" : "text-sm font-medium"}>{replyTime(median)}</div>
          <div className="text-muted-foreground">Median First Reply</div>
        </div>
      </div>
    </SettingsRow>
  );
}

/** Per person, from timestamps alone: work chats waiting for an answer and how long a first answer takes. */
export function ResponseSection({ stats, failed, load }: { stats: ResponseStat[] | null; failed: boolean; load: () => Promise<void> }) {
  const [days, setDays] = useState<7 | 30>(7);
  // A person who left with nothing waiting is not worth a row.
  const rows = (stats ?? []).filter((s) => s.active || s.unanswered30 > 0 || s.answered30 > 0);
  return (
    <SettingsSection
      id="response"
      title="Response Times"
      description="Work chats waiting for an answer, and the median time from a client's message to the first answer. It uses message times only, on chats shared with the team. Personal chats are never counted, and nothing of what was said is read."
    >
      <Tabs value={String(days)} onValueChange={(v) => setDays(v === "7" ? 7 : 30)}>
        <TabsList>
          <TabsTrigger value="7">Last 7 Days</TabsTrigger>
          <TabsTrigger value="30">Last 30 Days</TabsTrigger>
        </TabsList>
      </Tabs>
      {failed && !stats ? (
        <Alert variant="destructive">
          <AlertTitle>Could Not Load Response Times</AlertTitle>
          <AlertDescription>
            <p>Check your connection and try again.</p>
            <Button variant="secondary" className="mt-2" onClick={() => void load()}>Retry</Button>
          </AlertDescription>
        </Alert>
      ) : !stats ? (
        <Skeleton className="h-40 w-full rounded-lg" />
      ) : rows.length === 0 ? (
        <SettingsEmpty>No work chats yet, so there is nothing to time.</SettingsEmpty>
      ) : (
        <SettingsRows>{rows.map((s) => <PersonRow key={s.userId ?? "none"} s={s} days={days} />)}</SettingsRows>
      )}
      <p className="text-xs text-muted-foreground">An answer from the shared account or from a colleague&apos;s own account counts for the person the chat belongs to. Newsletters and notifications are left out.</p>
    </SettingsSection>
  );
}

/** "Sipho moved 12 chats to personal this week": counts per person and week, never which chats. */
export function MovedBackSection({ weeks, ready }: { weeks: WeekCount[]; ready: boolean }) {
  const byWeek = new Map<string, WeekCount[]>();
  for (const w of weeks) byWeek.set(w.week, [...(byWeek.get(w.week) ?? []), w]);
  return (
    <SettingsSection
      id="moved-back"
      title="Chats Moved Back to Personal"
      description="How many chats each person shared and moved back to personal, by week. You see the counts only: never which chats, or what was in them."
    >
      {!ready ? (
        <Skeleton className="h-24 w-full rounded-lg" />
      ) : byWeek.size === 0 ? (
        <SettingsEmpty>No chats were shared or moved back in the last 8 weeks.</SettingsEmpty>
      ) : (
        <SettingsRows>
          {[...byWeek.entries()].map(([week, list]) => (
            <SettingsRow
              key={week}
              title={weekLabel(week)}
              description={list.map((w) => [
                w.movedBack > 0 ? `${w.name} moved ${plural(w.movedBack, "chat")} to personal` : null,
                w.shared > 0 ? `${w.name} shared ${plural(w.shared, "chat")}` : null,
              ].filter(Boolean).join(", ")).join(". ")}
            />
          ))}
        </SettingsRows>
      )}
    </SettingsSection>
  );
}
