// Turns analytics events into the numbers on the Analytics page. Pure, so it is tested without a database.

export interface Row {
  at: string;
  user_hash: string;
  session: string | null;
  name: string;
  screen: string | null;
  size: string | null;
  props: Record<string, unknown>;
}

export interface Stat {
  value: number;
  /** The same count over the period just before, for the change. */
  prev: number;
}

export interface Counted {
  key: string;
  n: number;
}

const DAY = 86_400_000;

const str = (p: Record<string, unknown>, k: string) => (typeof p[k] === "string" ? (p[k] as string) : "");
const num = (p: Record<string, unknown>, k: string) => (typeof p[k] === "number" ? (p[k] as number) : 0);
const flag = (p: Record<string, unknown>, k: string) => p[k] === true;
const list = (p: Record<string, unknown>, k: string) => (Array.isArray(p[k]) ? (p[k] as unknown[]).filter((x): x is string => typeof x === "string") : []);
const time = (r: Row) => Date.parse(r.at);

export const pct = (part: number, whole: number) => (whole === 0 ? 0 : Math.round((part / whole) * 1000) / 10);

export function percentile(xs: number[], p: number): number {
  if (xs.length === 0) return 0;
  const sorted = [...xs].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1))];
}
export const median = (xs: number[]) => percentile(xs, 50);

function tally(keys: string[]): Counted[] {
  const m = new Map<string, number>();
  for (const k of keys) m.set(k, (m.get(k) ?? 0) + 1);
  return [...m].map(([key, n]) => ({ key, n })).sort((a, b) => b.n - a.n || a.key.localeCompare(b.key));
}

const named = (rows: Row[], name: string) => rows.filter((r) => r.name === name);

/** Events the workers write on their own. Someone is active only when they used the app, not when mail was sorted for them. */
const WORKER_EVENTS = new Set(["ai_call", "triaged", "sync_error", "send_result", "wa_reconnect", "first_sync_done", "sync_lag", "account_connect"]);
const byPerson = (rows: Row[]) => rows.filter((r) => !WORKER_EVENTS.has(r.name) || (r.name === "account_connect" && r.screen !== null));
const users = (rows: Row[]) => new Set(rows.map((r) => r.user_hash)).size;

/** Events in the last `days` days, and the same length of time before that. */
export function windows(rows: Row[], now: number, days: number): { now: Row[]; before: Row[] } {
  const from = now - days * DAY;
  const back = from - days * DAY;
  return {
    now: rows.filter((r) => time(r) >= from && time(r) <= now),
    before: rows.filter((r) => time(r) >= back && time(r) < from),
  };
}

function stat(now: Row[], before: Row[], count: (rows: Row[]) => number): Stat {
  return { value: count(now), prev: count(before) };
}

// ---- Usage

export interface UsageReport {
  activeUsers: Stat;
  sessions: Stat;
  opens: Stat;
  /** Share of last period's users who came back this period. */
  returnPct: number;
  series: { day: string; users: number; sessions: number }[];
  sizes: Counted[];
  screens: { screen: string; views: number; users: number; medianSecs: number }[];
  features: { feature: string; uses: number; users: number }[];
  dialogs: { dialog: string; opened: number; submitted: number; cancelled: number; abandonPct: number; medianSecs: number; fields: Counted[] }[];
  settings: Counted[];
  search: { count: number; avgLen: number; avgResults: number; pickedPct: number; avgRank: number };
  errors: { code: string; where: string; n: number; users: number }[];
  slow: { what: string; n: number; p50: number; p95: number }[];
  rage: Counted[];
  empty: Counted[];
  reliability: {
    syncErrors: { provider: string; code: string; n: number }[];
    sent: number;
    failed: number;
    failPct: number;
    retries: number;
    reconnects: number;
    lagP50: number;
    lagP95: number;
  };
}

export function usage(all: Row[], now: number, days: number): UsageReport {
  const { now: cur, before } = windows(all, now, days);
  const people = byPerson(cur);
  const peopleBefore = byPerson(before);
  const seriesStart = now - (days - 1) * DAY;
  const series = Array.from({ length: days }, (_, i) => {
    const day = new Date(seriesStart + i * DAY).toISOString().slice(0, 10);
    const rows = people.filter((r) => r.at.slice(0, 10) === day);
    return { day, users: users(rows), sessions: new Set(rows.map((r) => r.session).filter(Boolean)).size };
  });
  const prevUsers = new Set(peopleBefore.map((r) => r.user_hash));
  const curUsers = new Set(people.map((r) => r.user_hash));
  const returned = [...prevUsers].filter((u) => curUsers.has(u)).length;

  const views = named(cur, "screen_view");
  const times = named(cur, "screen_time");
  const screenNames = new Set([...views.map((r) => r.screen ?? ""), ...times.map((r) => r.screen ?? "")]);
  screenNames.delete("");

  const feats = named(cur, "feature_used");
  const featureNames = new Set(feats.map((r) => str(r.props, "feature")));
  const open = named(cur, "dialog_open");
  const closed = named(cur, "dialog_close");
  const dialogNames = new Set([...open, ...closed].map((r) => str(r.props, "dialog")));
  const searches = named(cur, "search");
  const picked = searches.filter((r) => num(r.props, "picked_rank") > 0);
  const errs = named(cur, "error");
  const loads = named(cur, "load_timing");
  const sends = named(cur, "send_result");
  const lags = named(cur, "sync_lag").map((r) => num(r.props, "secs"));
  const retried = sends.reduce((sum, r) => sum + Math.max(0, num(r.props, "attempts") - 1), 0);
  const sentOk = sends.filter((r) => str(r.props, "outcome") === "sent").length;

  const group = <T>(rows: Row[], key: (r: Row) => string, out: (k: string, rows: Row[]) => T) => {
    const m = new Map<string, Row[]>();
    for (const r of rows) m.set(key(r), [...(m.get(key(r)) ?? []), r]);
    return [...m].map(([k, v]) => out(k, v));
  };

  return {
    activeUsers: stat(people, peopleBefore, users),
    sessions: stat(people, peopleBefore, (rows) => new Set(rows.map((r) => r.session).filter(Boolean)).size),
    opens: stat(cur, before, (rows) => named(rows, "app_open").length),
    returnPct: pct(returned, prevUsers.size),
    series,
    sizes: tally(
      [...new Map(people.filter((r) => r.size).map((r) => [r.user_hash, r.size as string])).values()],
    ),
    screens: [...screenNames]
      .map((screen) => ({
        screen,
        views: views.filter((r) => r.screen === screen).length,
        users: users(views.filter((r) => r.screen === screen)),
        medianSecs: median(times.filter((r) => r.screen === screen).map((r) => num(r.props, "secs"))),
      }))
      .sort((a, b) => b.views - a.views),
    features: [...featureNames]
      .map((feature) => {
        const rows = feats.filter((r) => str(r.props, "feature") === feature);
        return { feature, uses: rows.length, users: users(rows) };
      })
      .sort((a, b) => b.uses - a.uses),
    dialogs: [...dialogNames]
      .map((dialog) => {
        const c = closed.filter((r) => str(r.props, "dialog") === dialog);
        const submitted = c.filter((r) => str(r.props, "outcome") === "submit").length;
        const cancelled = c.length - submitted;
        return {
          dialog,
          opened: open.filter((r) => str(r.props, "dialog") === dialog).length,
          submitted,
          cancelled,
          abandonPct: pct(cancelled, c.length),
          medianSecs: median(c.map((r) => num(r.props, "secs"))),
          fields: tally(c.flatMap((r) => list(r.props, "fields"))).slice(0, 8),
        };
      })
      .sort((a, b) => b.opened - a.opened),
    settings: tally(named(cur, "setting_changed").map((r) => str(r.props, "setting"))),
    search: {
      count: searches.length,
      avgLen: searches.length ? Math.round((searches.reduce((s, r) => s + num(r.props, "len"), 0) / searches.length) * 10) / 10 : 0,
      avgResults: searches.length ? Math.round((searches.reduce((s, r) => s + num(r.props, "results"), 0) / searches.length) * 10) / 10 : 0,
      pickedPct: pct(picked.length, searches.length),
      avgRank: picked.length ? Math.round((picked.reduce((s, r) => s + num(r.props, "picked_rank"), 0) / picked.length) * 10) / 10 : 0,
    },
    errors: group(errs, (r) => `${str(r.props, "code")}|${str(r.props, "where")}`, (k, rows) => ({
      code: k.split("|")[0],
      where: k.split("|")[1],
      n: rows.length,
      users: users(rows),
    })).sort((a, b) => b.n - a.n),
    slow: group(loads, (r) => str(r.props, "what"), (what, rows) => {
      const ms = rows.map((r) => num(r.props, "ms"));
      return { what, n: rows.length, p50: median(ms), p95: percentile(ms, 95) };
    }).sort((a, b) => b.p95 - a.p95),
    rage: tally(named(cur, "rage_click").map((r) => `${r.screen ?? "unknown"}:${str(r.props, "target")}`)),
    empty: tally(named(cur, "empty_state").map((r) => `${r.screen ?? "unknown"}:${str(r.props, "what")}`)),
    reliability: {
      syncErrors: group(named(cur, "sync_error"), (r) => `${str(r.props, "provider")}|${str(r.props, "code")}`, (k, rows) => ({
        provider: k.split("|")[0],
        code: k.split("|")[1],
        n: rows.length,
      })).sort((a, b) => b.n - a.n),
      sent: sentOk,
      failed: sends.length - sentOk,
      failPct: pct(sends.length - sentOk, sends.length),
      retries: retried,
      reconnects: named(cur, "wa_reconnect").length,
      lagP50: median(lags),
      lagP95: percentile(lags, 95),
    },
  };
}

// ---- AI

export const DIMENSIONS = ["sender", "channel", "bulk", "attach", "len", "hour", "known", "source", "prompt"] as const;
export type Dimension = (typeof DIMENSIONS)[number];
export type LabelFieldName = "priority" | "category" | "junk";

export interface Split {
  value: string;
  triaged: number;
  corrected: number;
  ratePct: number;
}

export interface AiReport {
  triaged: Stat;
  corrections: Stat;
  /** What the AI said against what was chosen: the most common first. */
  pairs: { field: string; from: string; to: string; n: number }[];
  junk: { shown: number; notJunk: number; falsePositivePct: number; missed: number; falseNegativePct: number };
  /** Correction rate for each label, split by one trait at a time, worst first. */
  splits: Record<LabelFieldName, Record<Dimension, Split[]>>;
  drafts: {
    requested: number;
    shown: number;
    sent: number;
    discarded: number;
    failed: number;
    asIsPct: number;
    editedPct: number;
    discardedPct: number;
    medianSecsToSend: number;
    medianMsToShow: number;
    avgRegenerated: number;
    avgChangedPct: number;
    medianLenPct: number;
    shorterPct: number;
    longerPct: number;
    greetingChangedPct: number;
    signoffChangedPct: number;
    questionAddedPct: number;
    questionRemovedPct: number;
    emojiAddedPct: number;
    toneMoved: Counted[];
    byTone: { tone: string; sent: number; asIsPct: number }[];
    byChannel: { channel: string; sent: number; asIsPct: number }[];
  };
  choices: { shown: number; tapped: number; tapPct: number; byKind: Counted[] };
  replies: { total: number; toNeedsReplyPct: number; medianHours: number; byPriority: { priority: string; n: number }[] };
  summaries: { opened: number; originalAfter: number; hitPct: number };
  brief: { plays: number; completedPct: number; stoppedAt: Counted[]; medianStopSecs: number; speeds: Counted[] };
  voice: { played: number; afterTranscript: number; failedPct: number; failed: number };
  cost: {
    usd: Stat;
    perActiveUserDayUsd: number;
    series: { day: string; usd: number }[];
    byFeature: { feature: string; calls: number; failPct: number; retries: number; p50: number; p95: number; usd: number; cachedPct: number; inTok: number; outTok: number }[];
    byPrompt: { feature: string; model: string; prompt: string; calls: number; failPct: number; p50: number; usd: number }[];
  };
}

const triageKey = (p: Record<string, unknown>, dim: Dimension): string => {
  const v = p[dim];
  return typeof v === "boolean" ? (v ? "yes" : "no") : typeof v === "string" ? v : "unknown";
};

function splitsFor(triaged: Row[], corrected: Row[], field: LabelFieldName): Record<Dimension, Split[]> {
  const out = {} as Record<Dimension, Split[]>;
  const fixes = corrected.filter((r) => str(r.props, "field") === field);
  for (const dim of DIMENSIONS) {
    const values = new Set([...triaged.map((r) => triageKey(r.props, dim)), ...fixes.map((r) => triageKey(r.props, dim))]);
    out[dim] = [...values]
      .map((value) => {
        const t = triaged.filter((r) => triageKey(r.props, dim) === value).length;
        const c = fixes.filter((r) => triageKey(r.props, dim) === value).length;
        return { value, triaged: t, corrected: c, ratePct: pct(c, t) };
      })
      .filter((s) => s.triaged > 0 || s.corrected > 0)
      .sort((a, b) => b.ratePct - a.ratePct || b.corrected - a.corrected);
  }
  return out;
}

function sentSummary(rows: Row[]) {
  return { sent: rows.length, asIsPct: pct(rows.filter((r) => !flag(r.props, "edited")).length, rows.length) };
}

export function ai(all: Row[], now: number, days: number): AiReport {
  const { now: cur, before } = windows(all, now, days);
  const triaged = named(cur, "triaged");
  const fixes = named(cur, "label_corrected");

  const jShown = triaged.filter((r) => flag(r.props, "junk")).length;
  const falsePositive = fixes.filter((r) => str(r.props, "field") === "junk" && str(r.props, "to") === "not_junk").length;
  const missed = fixes.filter((r) => str(r.props, "field") === "junk" && str(r.props, "to") === "junk").length;

  const sent = named(cur, "draft_sent");
  const edited = sent.filter((r) => flag(r.props, "edited"));
  const discarded = named(cur, "draft_discarded");
  const shown = named(cur, "draft_shown");
  const lens = edited.map((r) => num(r.props, "len_pct"));
  const share = (f: (r: Row) => boolean) => pct(edited.filter(f).length, edited.length);

  const group = <T>(rows: Row[], key: (r: Row) => string, out: (k: string, rows: Row[]) => T) => {
    const m = new Map<string, Row[]>();
    for (const r of rows) m.set(key(r), [...(m.get(key(r)) ?? []), r]);
    return [...m].map(([k, v]) => out(k, v));
  };

  const choiceShown = named(cur, "choice_shown");
  const tapped = named(cur, "choice_tapped");

  const replies = named(cur, "reply_sent");
  const opened = named(cur, "thread_opened");

  // A summary opened and then its original opened before the next conversation: the summary was not enough.
  const bySession = new Map<string, Row[]>();
  for (const r of cur) if (r.session && (r.name === "thread_opened" || r.name === "original_opened")) bySession.set(r.session, [...(bySession.get(r.session) ?? []), r]);
  let viaSummary = 0;
  let missedSummary = 0;
  for (const rows of bySession.values()) {
    rows.sort((a, b) => time(a) - time(b));
    rows.forEach((r, i) => {
      if (r.name !== "thread_opened" || str(r.props, "via") !== "summary") return;
      viaSummary++;
      if (rows[i + 1]?.name === "original_opened") missedSummary++;
    });
  }

  const plays = named(cur, "brief_play");
  const stops = named(cur, "brief_stop");
  const unfinished = stops.filter((r) => !flag(r.props, "done"));

  const calls = named(cur, "ai_call");
  const callsBefore = named(before, "ai_call");
  const usd = (rows: Row[]) => rows.reduce((s, r) => s + num(r.props, "cost_micro"), 0) / 1_000_000;
  const transcribe = calls.filter((r) => str(r.props, "feature") === "transcribe");
  const costDays = Array.from({ length: days }, (_, i) => new Date(now - (days - 1 - i) * DAY).toISOString().slice(0, 10));
  const activeDays = new Set(byPerson(cur).map((r) => `${r.user_hash}|${r.at.slice(0, 10)}`)).size;

  const timed = (rows: Row[]) => rows.filter((r) => num(r.props, "ms") > 0).map((r) => num(r.props, "ms"));
  const callStats = (rows: Row[]) => {
    const ms = timed(rows);
    return {
      calls: rows.length,
      failPct: pct(rows.filter((r) => !flag(r.props, "ok")).length, rows.length),
      retries: rows.reduce((s, r) => s + Math.max(0, num(r.props, "attempts") - 1), 0),
      p50: median(ms),
      p95: percentile(ms, 95),
      usd: Math.round(usd(rows) * 10000) / 10000,
    };
  };

  return {
    triaged: stat(cur, before, (rows) => named(rows, "triaged").length),
    corrections: stat(cur, before, (rows) => named(rows, "label_corrected").length),
    pairs: group(fixes, (r) => `${str(r.props, "field")}|${str(r.props, "from")}|${str(r.props, "to")}`, (k, rows) => {
      const [field, from, to] = k.split("|");
      return { field, from, to, n: rows.length };
    }).sort((a, b) => b.n - a.n).slice(0, 12),
    junk: {
      shown: jShown,
      notJunk: falsePositive,
      falsePositivePct: pct(falsePositive, jShown),
      missed,
      falseNegativePct: pct(missed, triaged.length - jShown),
    },
    splits: {
      junk: splitsFor(triaged, fixes, "junk"),
      priority: splitsFor(triaged, fixes, "priority"),
      category: splitsFor(triaged, fixes, "category"),
    },
    drafts: {
      requested: named(cur, "draft_requested").length,
      shown: shown.length,
      sent: sent.length,
      discarded: discarded.length,
      failed: named(cur, "draft_failed").length,
      asIsPct: pct(sent.length - edited.length, sent.length),
      editedPct: pct(edited.length, sent.length),
      discardedPct: pct(discarded.length, sent.length + discarded.length),
      medianSecsToSend: median(sent.map((r) => num(r.props, "secs_to_send"))),
      medianMsToShow: median(shown.map((r) => num(r.props, "ms"))),
      avgRegenerated: sent.length ? Math.round((sent.reduce((s, r) => s + num(r.props, "regenerated"), 0) / sent.length) * 10) / 10 : 0,
      avgChangedPct: edited.length ? Math.round(edited.reduce((s, r) => s + num(r.props, "changed_pct"), 0) / edited.length) : 0,
      medianLenPct: median(lens),
      shorterPct: pct(lens.filter((l) => l <= -10).length, lens.length),
      longerPct: pct(lens.filter((l) => l >= 10).length, lens.length),
      greetingChangedPct: share((r) => flag(r.props, "greeting_changed")),
      signoffChangedPct: share((r) => flag(r.props, "signoff_changed")),
      questionAddedPct: share((r) => flag(r.props, "q_added")),
      questionRemovedPct: share((r) => flag(r.props, "q_removed")),
      emojiAddedPct: share((r) => flag(r.props, "emoji_added")),
      toneMoved: tally(edited.map((r) => str(r.props, "tone_shift")).filter((t) => t && t !== "same")),
      byTone: group(sent, (r) => str(r.props, "tone"), (tone, rows) => ({ tone, ...sentSummary(rows) })).sort((a, b) => b.sent - a.sent),
      byChannel: group(sent, (r) => str(r.props, "channel"), (channel, rows) => ({ channel, ...sentSummary(rows) })).sort((a, b) => b.sent - a.sent),
    },
    choices: {
      shown: choiceShown.length,
      tapped: tapped.length,
      tapPct: pct(tapped.length, choiceShown.length),
      byKind: tally(tapped.map((r) => str(r.props, "kind"))),
    },
    replies: {
      total: replies.length,
      toNeedsReplyPct: pct(replies.filter((r) => flag(r.props, "was_needs_reply")).length, replies.length),
      medianHours: median(replies.map((r) => num(r.props, "hours_to_reply"))),
      byPriority: tally(replies.map((r) => str(r.props, "priority"))).map((c) => ({ priority: c.key, n: c.n })),
    },
    summaries: {
      opened: viaSummary || opened.filter((r) => str(r.props, "via") === "summary").length,
      originalAfter: missedSummary,
      hitPct: pct(viaSummary - missedSummary, viaSummary),
    },
    brief: {
      plays: plays.length,
      completedPct: pct(stops.filter((r) => flag(r.props, "done")).length, plays.length),
      stoppedAt: tally(unfinished.map((r) => { const p = num(r.props, "pct"); return p < 25 ? "0 to 25" : p < 50 ? "25 to 50" : p < 75 ? "50 to 75" : "75 to 100"; })),
      medianStopSecs: median(unfinished.map((r) => num(r.props, "pos_s"))),
      speeds: tally(plays.map((r) => String(num(r.props, "speed")))),
    },
    voice: {
      played: named(cur, "audio_played").length,
      afterTranscript: named(cur, "audio_played").filter((r) => flag(r.props, "after_transcript")).length,
      failed: transcribe.filter((r) => !flag(r.props, "ok")).length,
      failedPct: pct(transcribe.filter((r) => !flag(r.props, "ok")).length, transcribe.length),
    },
    cost: {
      usd: { value: usd(calls), prev: usd(callsBefore) },
      perActiveUserDayUsd: activeDays ? Math.round((usd(calls) / activeDays) * 10000) / 10000 : 0,
      series: costDays.map((day) => ({ day, usd: usd(calls.filter((r) => r.at.slice(0, 10) === day)) })),
      byFeature: group(calls, (r) => str(r.props, "feature"), (feature, rows) => {
        const input = rows.reduce((s, r) => s + num(r.props, "in_tok"), 0);
        const cached = rows.reduce((s, r) => s + (num(r.props, "in_tok") * num(r.props, "cached_pct")) / 100, 0);
        return { feature, ...callStats(rows), cachedPct: pct(cached, input), inTok: input, outTok: rows.reduce((s, r) => s + num(r.props, "out_tok"), 0) };
      }).sort((a, b) => b.usd - a.usd),
      byPrompt: group(calls, (r) => `${str(r.props, "feature")}|${str(r.props, "model")}|${str(r.props, "prompt")}`, (k, rows) => {
        const [feature, model, prompt] = k.split("|");
        const s = callStats(rows);
        return { feature, model, prompt, calls: s.calls, failPct: s.failPct, p50: s.p50, usd: s.usd };
      }).sort((a, b) => b.calls - a.calls),
    },
  };
}
