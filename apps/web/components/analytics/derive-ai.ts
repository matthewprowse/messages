// The numbers on the AI tab, worked out from the database's summary: label corrections and where the AI goes wrong, drafts,
// replies, and what the model calls cost. Split from derive.ts to keep each file focused; shared helpers are in derive-util.ts.

import { DIMENSIONS, type Counted, type Dimension, type LabelFieldName, type Stat } from "@messages/analytics/stats";
import type { Summary, SummaryGroup } from "@/lib/analytics-data";
import { bucket, count, flag, lastDays, round1, round4, stat, str, sumOf, tally, view, type Part } from "./derive-util";

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
  replies: { total: number; toNeedsReply: Part; byPriority: { priority: string; n: number }[] };
  summaries: { enough: Part; originalAfter: number };
  brief: { plays: number; completed: Part; medianStopSecs: number };
  voice: { played: number; afterTranscript: number; transcriptsFailed: Part };
  cost: {
    calls: number;
    failed: number;
    inTok: number;
    cachedTok: number;
    usd: Stat;
    /** The model cost per person over a 30 day month, from the people who cost anything: the average, the 90th percentile and the dearest five. */
    perUserMonth: { users: number; avgUsd: number; p90Usd: number; top: { user: string; usd: number }[] };
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

/** Per person cost scaled to a 30 day month. Uses everyone who cost anything (bulk triage and first syncs included), not only the people active in the period, which overstated cost per active day. */
function perUserMonth(s: Summary, days: number): AiReport["cost"]["perUserMonth"] {
  const c = s.cost_users;
  const scale = (micro: number) => round4(((micro / 1_000_000) * 30) / Math.max(1, days));
  return { users: c.users, avgUsd: c.users ? scale(c.total_micro / c.users) : 0, p90Usd: scale(c.p90_micro), top: c.top.map((t) => ({ user: t.user, usd: scale(t.micro) })) };
}

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
      perUserMonth: perUserMonth(s, days),
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
