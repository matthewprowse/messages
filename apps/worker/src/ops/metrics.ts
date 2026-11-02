// Structured counters for the things an operator watches: sends, syncs, AI calls and failures. They are kept in memory,
// written to the log as one parseable JSON line a minute (the change since the last line, so a log pipeline can sum them),
// and served in Prometheus text form on the health port. Names and label values are fixed words and codes, never message
// text, names or addresses; a label value that does not look like a code is stored as "other".

import { log } from "../log";

export const METRICS_FLUSH_MS = 60_000;

const totals = new Map<string, number>();
const sinceFlush = new Map<string, number>();

/** Label values are codes and outcomes. Anything else (free text, an address) must not become a metric key. */
export function safeLabel(value: string | undefined): string {
  return value !== undefined && /^[A-Za-z0-9_.:-]{1,40}$/.test(value) ? value : "other";
}

/** The key one series is stored under: `name` or `name{label=value,...}` with labels sorted. */
export function seriesKey(name: string, labels?: Record<string, string>): string {
  const pairs = Object.entries(labels ?? {}).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([k, v]) => `${k}=${safeLabel(v)}`);
  return pairs.length ? `${name}{${pairs.join(",")}}` : name;
}

export function count(name: string, labels?: Record<string, string>, by = 1) {
  const key = seriesKey(name, labels);
  totals.set(key, (totals.get(key) ?? 0) + by);
  sinceFlush.set(key, (sinceFlush.get(key) ?? 0) + by);
}

// The four families the runbook alerts on. Small wrappers so call sites say what happened, not how it is keyed.
export const countSend = (channel: string, outcome: "ok" | "failed") => count("sends", { channel, outcome });
export const countSync = (kind: string) => count("syncs", { kind });
export const countAiCall = (feature: string, outcome: "ok" | "failed") => count("ai_calls", { feature, outcome });
export const countFailure = (code: string, where: string) => count("failures", { code, where });

export function snapshot(): Record<string, number> {
  return Object.fromEntries(totals);
}

/** Writes the counters that moved since the last flush as one log line. Nothing moved, nothing written. */
export function flush(windowSeconds = METRICS_FLUSH_MS / 1000) {
  if (sinceFlush.size === 0) return;
  log.info("metrics", { window_s: windowSeconds, ...Object.fromEntries(sinceFlush) });
  sinceFlush.clear();
}

/** Prometheus text exposition of the running totals (`konva_sends{channel="gmail",outcome="ok"} 3`). */
export function renderPrometheus(): string {
  const lines: string[] = [];
  for (const [key, value] of [...totals.entries()].sort(([a], [b]) => (a < b ? -1 : 1))) {
    const open = key.indexOf("{");
    if (open === -1) { lines.push(`konva_${key} ${value}`); continue; }
    const labels = key.slice(open + 1, -1).split(",").map((p) => { const [k, v] = p.split("="); return `${k}="${v}"`; }).join(",");
    lines.push(`konva_${key.slice(0, open)}{${labels}} ${value}`);
  }
  return lines.join("\n") + (lines.length ? "\n" : "");
}

export function startMetricsFlush(ms = METRICS_FLUSH_MS): () => void {
  const timer = setInterval(() => flush(ms / 1000), ms);
  timer.unref();
  return () => clearInterval(timer);
}

/** For tests. */
export function resetMetrics() {
  totals.clear();
  sinceFlush.clear();
}
