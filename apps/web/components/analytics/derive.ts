// The numbers on the Analytics page, worked out from the database's summary (analytics_summary). The summary groups
// events by period, name, screen and every non-numeric prop, with the numeric props summed, so counts are sums over
// groups and medians come from its percentile list. People cannot be added up across groups, so where several groups
// make up one row the largest group's people are shown.

import { DIMENSIONS, type Counted, type Dimension, type LabelFieldName, type Stat } from "@messages/analytics/stats";
import type { Summary, SummaryGroup } from "@/lib/analytics-data";

const DAY = 86_400_000;

const str = (g: SummaryGroup, k: string) => (typeof g.props[k] === "string" ? (g.props[k] as string) : "");
const flag = (g: SummaryGroup, k: string) => g.props[k] === true;
const list = (g: SummaryGroup, k: string) => (Array.isArray(g.props[k]) ? (g.props[k] as unknown[]).filter((x): x is string => typeof x === "string") : []);
const count = (gs: SummaryGroup[]) => gs.reduce((s, g) => s + g.n, 0);
const sumOf = (gs: SummaryGroup[], key: string) => gs.reduce((s, g) => s + (g.nums[key]?.sum ?? 0), 0);
const people = (gs: SummaryGroup[]) => gs.reduce((m, g) => Math.max(m, g.users), 0);
const round1 = (n: number) => Math.round(n * 10) / 10;
const round4 = (n: number) => Math.round(n * 10000) / 10000;

function bucket(gs: SummaryGroup[], key: (g: SummaryGroup) => string): Map<string, SummaryGroup[]> {
  const m = new Map<string, SummaryGroup[]>();
  for (const g of gs) m.set(key(g), [...(m.get(key(g)) ?? []), g]);
  return m;
}

/** Keys with their counts, the most common first. */
function tally(pairs: [string, number][]): Counted[] {
  const m = new Map<string, number>();
  for (const [k, n] of pairs) m.set(k, (m.get(k) ?? 0) + n);
  return [...m].map(([key, n]) => ({ key, n })).sort((a, b) => b.n - a.n || a.key.localeCompare(b.key));
}

export interface Part {
  part: number;
  whole: number;
}

export interface Retention {
  /** Start of the week the group was first seen, as an ISO date. */
  start: string;
  size: number;
  /** For each week after: how many of the group were seen again. Fewer entries when the weeks have not happened yet. */
  later: number[];
}

/** One period's groups and the lookups on them. */
function view(s: Summary, period: "now" | "before") {
  const groups = s.groups.filter((g) => g.period === period);
  return {
    named: (name: string) => groups.filter((g) => g.name === name),
    pctile: (metric: string, key = ""): { n: number; p50: number; p95: number } =>
      s.percentiles.find((p) => p.period === period && p.metric === metric && p.key === key) ?? { n: 0, p50: 0, p95: 0 },
    percentiles: (metric: string) => s.percentiles.filter((p) => p.period === period && p.metric === metric),
  };
}

/** The last `days` UTC days, ending on the day of the summary's end. */
function lastDays(end: number, days: number): string[] {
  return Array.from({ length: days }, (_, i) => new Date(end - (days - 1 - i) * DAY).toISOString().slice(0, 10));
}

const stat = (value: number, prev: number): Stat => ({ value, prev });

// ---- Usage

export interface UsageReport {
  activeUsers: Stat;
  sessions: Stat;
  opens: Stat;
  cameBack: Part;
  picked: Part;
  activation: { active: number; connected: number; sentDraft: number };
  retention: Retention[];
  series: { day: string; users: number }[];
  sizes: Counted[];
  screens: { screen: string; views: number; users: number; medianSecs: number }[];
  features: { feature: string; uses: number; users: number }[];
  dialogs: { dialog: string; opened: number; submitted: number; cancelled: number; medianSecs: number; fields: Counted[] }[];
  settings: Counted[];
  search: { count: number; avgLen: number; avgResults: number; avgRank: number };
  errors: { code: string; where: string; n: number; users: number }[];
  slow: { what: string; n: number; p50: number; p95: number }[];
  rage: Counted[];
  empty: Counted[];
  reliability: {
    syncErrors: { provider: string; code: string; n: number }[];
    sent: number;
    failed: number;
    retries: number;
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
    activation: { active: s.activation.active, connected: s.activation.connected, sentDraft: s.activation.sent_draft },
    retention: s.retention.map((r) => ({ start: r.start, size: r.size, later: r.later })),
    series: lastDays(Date.parse(s.to), days).map((day) => ({ day, users: dayUsers.get(day) ?? 0 })),
    sizes: s.sizes,
    screens: [...screenNames]
      .map((screen) => {
        const rows = views.filter((g) => g.screen === screen);
        return { screen, views: count(rows), users: people(rows), medianSecs: v.pctile("screen_time.secs", screen).p50 };
      })
      .sort((a, b) => b.views - a.views),
    features: [...feats]
      .map(([feature, rows]) => ({ feature, uses: count(rows), users: people(rows) }))
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
    settings: tally(v.named("setting_changed").map((g) => [str(g, "setting"), g.n])),
    search: {
      count: searches,
      avgLen: searches ? round1(sumOf(search, "len") / searches) : 0,
      avgResults: searches ? round1(sumOf(search, "results") / searches) : 0,
      avgRank: pickedN ? round1(sumOf(search, "picked_rank") / pickedN) : 0,
    },
    errors: [...errors]
      .map(([k, rows]) => ({ code: k.split("|")[0], where: k.split("|")[1], n: count(rows), users: people(rows) }))
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
      // Attempts beyond the first, from the attempts summed over the sends.
      retries: Math.max(0, sends.reduce((n, g) => n + Math.max(0, (g.nums.attempts?.sum ?? 0) - (g.nums.attempts?.n ?? 0)), 0)),
      reconnects: count(v.named("wa_reconnect")),
    },
  };
}

// ---- AI

export interface Split {
  value: string;
  triaged: number;
  corrected: number;
}

export interface AiReport {
  triaged: Stat;
  corrections: Stat;
  /** What the AI said against what was chosen: the most common first. */
  pairs: { field: string; from: string; to: string; n: number }[];
  junk: { shown: number; notJunk: number; missed: number; notShown: number };
  /** The labels people corrected, for each label split by one trait at a time, worst first. */
  splits: Record<LabelFieldName, Record<Dimension, Split[]>>;
  drafts: {
    requested: number;
    shown: number;
    failed: number;
    sent: number;
    discarded: number;
    asWritten: Part;
    edited: Part;
    avgChangedPct: number;
    medianSecsToSend: number;
    medianMsToShow: number;
    avgRegenerated: number;
    /** Each of the edited drafts. */
    greeting: Part;
    signoff: Part;
    questionAdded: Part;
    questionRemoved: Part;
    emoji: Part;
    toneMoved: Counted[];
    byTone: { tone: string; sent: number; asWritten: Part }[];
    byChannel: { channel: string; sent: number; asWritten: Part }[];
    /** Drafts written before they were asked for: how many were used. Written minus sent and thrown away went unused. */
    pre: { written: number; sent: number; asWritten: Part; discarded: number };
  };
  choices: { shown: number; tapped: number; byKind: Counted[] };
  replies: { total: number; toNeedsReply: Part; medianHours: number; byPriority: { priority: string; n: number }[] };
  summaries: { enough: Part; originalAfter: number };
  brief: { plays: number; completed: Part; medianStopSecs: number };
  voice: { played: number; afterTranscript: number; transcriptsFailed: Part };
  cost: {
    calls: number;
    failed: number;
    inTok: number;
    cachedTok: number;
    usd: Stat;
    perActiveUserDayUsd: number;
    series: { day: string; usd: number }[];
    byFeature: { feature: string; calls: number; failed: number; retries: number; p50: number; p95: number; usd: number; inTok: number; cachedTok: number }[];
    byPrompt: { feature: string; model: string; prompt: string; calls: number; failed: number; p50: number; usd: number }[];
  };
}

const triageKey = (g: SummaryGroup, dim: Dimension): string => {
  const v = g.props[dim];
  return typeof v === "boolean" ? (v ? "yes" : "no") : typeof v === "string" ? v : "unknown";
};

function splitsFor(triaged: SummaryGroup[], fixes: SummaryGroup[], field: LabelFieldName): Record<Dimension, Split[]> {
  const out = {} as Record<Dimension, Split[]>;
  const mine = fixes.filter((g) => str(g, "field") === field);
  for (const dim of DIMENSIONS) {
    const m = new Map<string, Split>();
    const at = (value: string) => m.get(value) ?? (m.set(value, { value, triaged: 0, corrected: 0 }), m.get(value)!);
    for (const g of triaged) at(triageKey(g, dim)).triaged += g.n;
    for (const g of mine) at(triageKey(g, dim)).corrected += g.n;
    const rate = (x: Split) => (x.triaged === 0 ? 0 : x.corrected / x.triaged);
    out[dim] = [...m.values()].filter((x) => x.triaged > 0 || x.corrected > 0).sort((a, b) => rate(b) - rate(a) || b.corrected - a.corrected);
  }
  return out;
}

const usdOf = (gs: SummaryGroup[]) => sumOf(gs, "cost_micro") / 1_000_000;

/**
 * Input tokens the model had cached. Each call's share is not in the summary, only the shares added up, so this is
 * the group's input tokens times its average cached share: close for a group whose calls cache alike.
 */
const cachedOf = (gs: SummaryGroup[]) => gs.reduce((s, g) => s + (g.n === 0 ? 0 : ((g.nums.in_tok?.sum ?? 0) * ((g.nums.cached_pct?.sum ?? 0) / g.n)) / 100), 0);
const retriesOf = (gs: SummaryGroup[]) => gs.reduce((s, g) => s + Math.max(0, (g.nums.attempts?.sum ?? 0) - (g.nums.attempts?.n ?? 0)), 0);

export function aiReport(s: Summary, days: number): AiReport {
  const v = view(s, "now");
  const b = view(s, "before");

  const triaged = v.named("triaged");
  const fixes = v.named("label_corrected");
  const junkShown = count(triaged.filter((g) => flag(g, "junk")));
  const toJunk = (to: string) => count(fixes.filter((g) => str(g, "field") === "junk" && str(g, "to") === to));

  const sent = v.named("draft_sent");
  const edited = sent.filter((g) => flag(g, "edited"));
  const ofEdited = (test: (g: SummaryGroup) => boolean): Part => ({ part: count(edited.filter(test)), whole: count(edited) });
  const asWritten = (gs: SummaryGroup[]): Part => ({ part: count(gs.filter((g) => !flag(g, "edited"))), whole: count(gs) });
  const sentBy = (key: string) =>
    [...bucket(sent, (g) => str(g, key))]
      .map(([k, rows]) => ({ k, sent: count(rows), asWritten: asWritten(rows) }))
      .sort((a, c) => c.sent - a.sent);

  const replies = v.named("reply_sent");
  const tapped = v.named("choice_tapped");
  const plays = count(v.named("brief_play"));
  const audio = v.named("audio_played");
  const calls = v.named("ai_call");
  const transcribe = calls.filter((g) => str(g, "feature") === "transcribe");
  const failedOf = (gs: SummaryGroup[]) => count(gs.filter((g) => !flag(g, "ok")));
  const opened = s.summaries.opened;
  const callsBefore = b.named("ai_call");

  const costByDay = new Map(s.events.filter((e) => e.name === "ai_call").map((e) => [e.day.slice(0, 10), (e.sums.cost_micro ?? 0) / 1_000_000]));

  return {
    triaged: stat(count(triaged), count(b.named("triaged"))),
    corrections: stat(count(fixes), count(b.named("label_corrected"))),
    pairs: [...bucket(fixes, (g) => `${str(g, "field")}|${str(g, "from")}|${str(g, "to")}`)]
      .map(([k, rows]) => {
        const [field, from, to] = k.split("|");
        return { field, from, to, n: count(rows) };
      })
      .sort((a, c) => c.n - a.n)
      .slice(0, 12),
    junk: { shown: junkShown, notJunk: toJunk("not_junk"), missed: toJunk("junk"), notShown: Math.max(0, count(triaged) - junkShown) },
    splits: {
      junk: splitsFor(triaged, fixes, "junk"),
      priority: splitsFor(triaged, fixes, "priority"),
      category: splitsFor(triaged, fixes, "category"),
    },
    drafts: {
      requested: count(v.named("draft_requested")),
      shown: count(v.named("draft_shown")),
      failed: count(v.named("draft_failed")),
      sent: count(sent),
      discarded: count(v.named("draft_discarded")),
      asWritten: asWritten(sent),
      edited: { part: count(edited), whole: count(sent) },
      avgChangedPct: edited.length ? Math.round(sumOf(edited, "changed_pct") / count(edited)) : 0,
      medianSecsToSend: v.pctile("draft_sent.secs_to_send").p50,
      medianMsToShow: v.pctile("draft_shown.ms").p50,
      avgRegenerated: sent.length ? round1(sumOf(sent, "regenerated") / count(sent)) : 0,
      greeting: ofEdited((g) => flag(g, "greeting_changed")),
      signoff: ofEdited((g) => flag(g, "signoff_changed")),
      questionAdded: ofEdited((g) => flag(g, "q_added")),
      questionRemoved: ofEdited((g) => flag(g, "q_removed")),
      emoji: ofEdited((g) => flag(g, "emoji_added")),
      toneMoved: tally(edited.map((g): [string, number] => [str(g, "tone_shift"), g.n]).filter(([k]) => k && k !== "same")),
      byTone: sentBy("tone").map((x) => ({ tone: x.k, sent: x.sent, asWritten: x.asWritten })),
      byChannel: sentBy("channel").map((x) => ({ channel: x.k, sent: x.sent, asWritten: x.asWritten })),
      pre: {
        written: count(v.named("draft_shown").filter((g) => flag(g, "auto"))),
        sent: count(sent.filter((g) => flag(g, "auto"))),
        asWritten: asWritten(sent.filter((g) => flag(g, "auto"))),
        discarded: count(v.named("draft_discarded").filter((g) => flag(g, "auto"))),
      },
    },
    choices: { shown: count(v.named("choice_shown")), tapped: count(tapped), byKind: tally(tapped.map((g) => [str(g, "kind"), g.n])) },
    replies: {
      total: count(replies),
      toNeedsReply: { part: count(replies.filter((g) => flag(g, "was_needs_reply"))), whole: count(replies) },
      medianHours: v.pctile("reply_sent.hours_to_reply").p50,
      byPriority: tally(replies.map((g) => [str(g, "priority"), g.n])).map((c) => ({ priority: c.key, n: c.n })),
    },
    summaries: { enough: { part: Math.max(0, opened - s.summaries.original_after), whole: opened }, originalAfter: s.summaries.original_after },
    brief: {
      plays,
      completed: { part: count(v.named("brief_stop").filter((g) => flag(g, "done"))), whole: plays },
      medianStopSecs: v.pctile("brief_stop.pos_s").p50,
    },
    voice: {
      played: count(audio),
      afterTranscript: count(audio.filter((g) => flag(g, "after_transcript"))),
      transcriptsFailed: { part: failedOf(transcribe), whole: count(transcribe) },
    },
    cost: {
      calls: count(calls),
      failed: failedOf(calls),
      inTok: sumOf(calls, "in_tok"),
      cachedTok: cachedOf(calls),
      usd: stat(usdOf(calls), usdOf(callsBefore)),
      perActiveUserDayUsd: s.periods.now.user_days ? round4(usdOf(calls) / s.periods.now.user_days) : 0,
      series: lastDays(Date.parse(s.to), days).map((day) => ({ day, usd: costByDay.get(day) ?? 0 })),
      byFeature: [...bucket(calls, (g) => str(g, "feature"))]
        .map(([feature, rows]) => ({
          feature,
          calls: count(rows),
          failed: failedOf(rows),
          retries: retriesOf(rows),
          p50: v.pctile("ai_call.ms", feature).p50,
          p95: v.pctile("ai_call.ms", feature).p95,
          usd: round4(usdOf(rows)),
          inTok: sumOf(rows, "in_tok"),
          cachedTok: cachedOf(rows),
        }))
        .sort((a, c) => c.usd - a.usd),
      byPrompt: [...bucket(calls, (g) => `${str(g, "feature")}|${str(g, "model")}|${str(g, "prompt")}`)]
        .map(([k, rows]) => {
          const [feature, model, prompt] = k.split("|");
          return { feature, model, prompt, calls: count(rows), failed: failedOf(rows), p50: v.pctile("ai_call.ms_prompt", k).p50, usd: round4(usdOf(rows)) };
        })
        .sort((a, c) => c.calls - a.calls),
    },
  };
}

/** Both tabs' numbers from one summary. `days` is the length of the period shown. */
export function build(s: Summary, days: number): { usage: UsageReport; ai: AiReport; empty: boolean } {
  return { usage: usageReport(s, days), ai: aiReport(s, days), empty: s.periods.now.events + s.periods.before.events === 0 };
}
