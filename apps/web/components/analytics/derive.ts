// The numbers on the Usage tab, worked out from the database's summary (analytics_summary), and `build`, which makes both
// the Usage and the AI report from one summary. The summary groups events by period, name, screen and every non-numeric
// prop, so counts are sums over groups and medians come from its percentile list. People cannot be added up across
// groups, so the database sends real people for the rows that need them (summary.distinct_users).

import type { Counted, Stat } from "@messages/analytics/stats";
import type { Summary, SummaryGroup } from "@/lib/analytics-data";
import { aiReport, type AiReport } from "./derive-ai";
import { bucket, count, lastDays, list, stat, str, tally, view, type Part } from "./derive-util";

export type { Part } from "./derive-util";

export interface UsageReport {
  activeUsers: Stat;
  sessions: Stat;
  opens: Stat;
  cameBack: Part;
  picked: Part;
  searches: number;
  /** Events the rate limit threw away in the period: when this is not 0 every count is a little low. */
  dropped: number;
  series: { day: string; users: number }[];
  screens: { screen: string; views: number; users: number; medianSecs: number }[];
  features: { feature: string; uses: number; users: number }[];
  dialogs: { dialog: string; opened: number; submitted: number; cancelled: number; medianSecs: number; fields: Counted[] }[];
  errors: { code: string; where: string; n: number; users: number }[];
  slow: { what: string; n: number; p50: number; p95: number }[];
  rage: Counted[];
  empty: Counted[];
  reliability: {
    syncErrors: { provider: string; code: string; n: number }[];
    sent: number;
    failed: number;
    reconnects: number;
  };
}

export function usageReport(s: Summary, days: number): UsageReport {
  const v = view(s, "now");
  const dayUsers = new Map(s.daily.map((d) => [d.day.slice(0, 10), d.users]));

  const views = v.named("screen_view");
  const screenNames = new Set([...views.map((g) => g.screen ?? ""), ...v.named("screen_time").map((g) => g.screen ?? "")]);
  screenNames.delete("");

  const feats = bucket(v.named("feature_used"), (g) => str(g, "feature"));
  const open = v.named("dialog_open");
  const closed = v.named("dialog_close");
  const dialogNames = new Set([...open, ...closed].map((g) => str(g, "dialog")));

  const search = v.named("search");
  const searches = count(search);
  const pickedN = search.reduce((n, g) => n + (g.nums.picked_rank?.n ?? 0), 0);

  const errors = bucket(v.named("error"), (g) => `${str(g, "code")}|${str(g, "where")}`);
  const syncErrors = bucket(v.named("sync_error"), (g) => `${str(g, "provider")}|${str(g, "code")}`);
  const sends = v.named("send_result");
  const sentOk = count(sends.filter((g) => str(g, "outcome") === "sent"));
  const where = (g: SummaryGroup, key: string) => `${g.screen ?? "unknown"}:${str(g, key)}`;

  return {
    activeUsers: stat(s.periods.now.users, s.periods.before.users),
    sessions: stat(s.periods.now.sessions, s.periods.before.sessions),
    opens: stat(s.periods.now.opens, s.periods.before.opens),
    cameBack: { part: s.came_back, whole: s.periods.before.users },
    // A pick is recorded only when a result was chosen, so the picks are the searches that carry a rank.
    picked: { part: pickedN, whole: searches },
    searches,
    dropped: s.dropped,
    series: lastDays(Date.parse(s.to), days).map((day) => ({ day, users: dayUsers.get(day) ?? 0 })),
    screens: [...screenNames]
      .map((screen) => ({ screen, views: count(views.filter((g) => g.screen === screen)), users: v.people("screen_view.screen", screen), medianSecs: v.pctile("screen_time.secs", screen).p50 }))
      .sort((a, b) => b.views - a.views),
    features: [...feats]
      .map(([feature, rows]) => ({ feature, uses: count(rows), users: v.people("feature_used.feature", feature) }))
      .sort((a, b) => b.uses - a.uses),
    dialogs: [...dialogNames]
      .map((dialog) => {
        const c = closed.filter((g) => str(g, "dialog") === dialog);
        const submitted = count(c.filter((g) => str(g, "outcome") === "submit"));
        return {
          dialog,
          opened: count(open.filter((g) => str(g, "dialog") === dialog)),
          submitted,
          cancelled: count(c) - submitted,
          medianSecs: v.pctile("dialog_close.secs", dialog).p50,
          fields: tally(c.flatMap((g) => list(g, "fields").map((f): [string, number] => [f, g.n]))).slice(0, 8),
        };
      })
      .sort((a, b) => b.opened - a.opened),
    errors: [...errors]
      .map(([k, rows]) => ({ code: k.split("|")[0], where: k.split("|")[1], n: count(rows), users: v.people("error.code_where", k) }))
      .sort((a, b) => b.n - a.n),
    slow: v
      .percentiles("load_timing.ms")
      .map((p) => ({ what: p.key, n: p.n, p50: p.p50, p95: p.p95 }))
      .sort((a, b) => b.p95 - a.p95),
    rage: tally(v.named("rage_click").map((g) => [where(g, "target"), g.n])),
    empty: tally(v.named("empty_state").map((g) => [where(g, "what"), g.n])),
    reliability: {
      syncErrors: [...syncErrors].map(([k, rows]) => ({ provider: k.split("|")[0], code: k.split("|")[1], n: count(rows) })).sort((a, b) => b.n - a.n),
      sent: sentOk,
      failed: count(sends) - sentOk,
      reconnects: count(v.named("wa_reconnect")),
    },
  };
}

/** Both tabs' numbers from one summary. `days` is the length of the period shown. */
export function build(s: Summary, days: number): { usage: UsageReport; ai: AiReport; empty: boolean } {
  return { usage: usageReport(s, days), ai: aiReport(s, days), empty: s.periods.now.events + s.periods.before.events === 0 };
}
