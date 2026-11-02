// A content-free error reporter. An error becomes a code, the class name, the place it was caught (a fixed word chosen by
// the caller) and stack frames (function, file inside the repo, line, column). Never the error's message, which can echo
// message text, a name or an address, and never arguments or variables. Each report is counted and logged as JSON; when
// ERROR_TRACKER_DSN is set it is also forwarded to a Sentry-compatible tracker. The tracker client lives behind the
// ErrorSink interface and speaks Sentry's envelope protocol over fetch, so there is no SDK to audit (an SDK would
// capture request data and breadcrumbs by default, which is the opposite of what this app promises).

import { randomBytes } from "node:crypto";
import { errorCode, log } from "../log";
import { countFailure, safeLabel } from "./metrics";

export interface Frame { fn: string; file: string; line: number; col: number }
export interface ErrorReport { code: string; cls: string; where: string; frames: Frame[] }
export interface ErrorSink { capture(report: ErrorReport): void }

const MAX_FRAMES = 12;
// "    at fn (file:line:col)" or "    at file:line:col" (V8). Anything else on a stack line is ignored.
const FRAME = /^\s*at (?:(.+?) \()?(.+?):(\d+):(\d+)\)?$/;

/** A path trimmed to where it sits in the repo or a package, so no home directory or user name is reported. */
export function trimPath(path: string): string {
  const clean = path.replace(/^file:\/\//, "");
  const marker = /(?:^|\/)((?:apps|packages|node_modules)\/.*)$/.exec(clean);
  if (marker) return marker[1];
  return clean.startsWith("node:") ? clean : (clean.split("/").pop() ?? "unknown");
}

/** Frames from a V8 stack, newest first. Only lines starting "at" count, so the message line (which can hold content) is never read. */
export function framesOf(stack: string | undefined): Frame[] {
  const out: Frame[] = [];
  for (const line of (stack ?? "").split("\n")) {
    const m = FRAME.exec(line);
    if (!m) continue;
    out.push({ fn: m[1] ? m[1].replace(/^async /, "") : "<anonymous>", file: trimPath(m[2]), line: Number(m[3]), col: Number(m[4]) });
    if (out.length >= MAX_FRAMES) break;
  }
  return out;
}

export function describe(err: unknown, where: string): ErrorReport {
  const cls = err && typeof err === "object" && typeof (err as { name?: unknown }).name === "string" ? safeLabel((err as { name: string }).name) : "unknown";
  const stack = err && typeof err === "object" ? (err as { stack?: unknown }).stack : undefined;
  return { code: safeLabel(errorCode(err)), cls, where: safeLabel(where), frames: framesOf(typeof stack === "string" ? stack : undefined) };
}

let sink: ErrorSink | null = null;
export function setErrorSink(next: ErrorSink | null) { sink = next; }

// One forward per place and code a minute: a failing loop must not turn into thousands of tracker events (counts still go up).
const FORWARD_EVERY_MS = 60_000;
const lastForward = new Map<string, number>();

/** Counts, logs and (if a tracker is set up) forwards one error. Never throws. */
export function reportError(err: unknown, where: string, now = Date.now()): ErrorReport {
  const report = describe(err, where);
  try {
    countFailure(report.code, report.where);
    log.error(`${report.where} failed`, { code: report.code, cls: report.cls, where: report.where, frames: report.frames.map((f) => `${f.fn}@${f.file}:${f.line}`).join(" < ") });
    const key = `${report.where}:${report.code}`;
    if (sink && now - (lastForward.get(key) ?? 0) >= FORWARD_EVERY_MS) {
      lastForward.set(key, now);
      sink.capture(report);
    }
  } catch {
    // reporting must never be the thing that breaks the caller
  }
  return report;
}

export interface ParsedDsn { url: string; key: string }

/** `https://<key>@host/<project>` to the envelope URL and public key; null when it is not one. */
export function parseDsn(dsn: string): ParsedDsn | null {
  try {
    const u = new URL(dsn);
    const parts = u.pathname.split("/").filter(Boolean);
    const project = parts.pop();
    if (!u.username || !project || (u.protocol !== "https:" && u.protocol !== "http:")) return null;
    return { url: `${u.protocol}//${u.host}${parts.length ? `/${parts.join("/")}` : ""}/api/${project}/envelope/`, key: u.username };
  } catch {
    return null;
  }
}

/** The envelope body for one report: only the code, class, place and frames. No user, request, breadcrumbs or message. */
export function envelopeFor(report: ErrorReport, service: string, dsn: string, now = Date.now(), id = randomBytes(16).toString("hex")): string {
  const event = {
    event_id: id,
    timestamp: Math.floor(now / 1000),
    platform: "node",
    level: "error",
    logger: service,
    tags: { service, where: report.where, code: report.code },
    exception: { values: [{ type: report.cls, value: report.code, stacktrace: { frames: [...report.frames].reverse().map((f) => ({ function: f.fn, filename: f.file, lineno: f.line, colno: f.col })) } }] },
  };
  return [JSON.stringify({ event_id: id, sent_at: new Date(now).toISOString(), dsn }), JSON.stringify({ type: "event" }), JSON.stringify(event)].join("\n");
}

/** The tracker client. Fire and forget with a short timeout; a tracker outage is ignored. */
export function sentrySink(dsn: string, service: string, send: typeof fetch = fetch): ErrorSink | null {
  const parsed = parseDsn(dsn);
  if (!parsed) return null;
  return {
    capture(report) {
      void send(parsed.url, {
        method: "POST",
        headers: { "content-type": "application/x-sentry-envelope", "x-sentry-auth": `Sentry sentry_version=7, sentry_client=konva-ops/1, sentry_key=${parsed.key}` },
        body: envelopeFor(report, service, dsn),
        signal: AbortSignal.timeout(5_000),
      }).catch(() => {});
    },
  };
}

/** Sets up forwarding from ERROR_TRACKER_DSN. Unset or malformed: errors are still counted and logged. */
export function initErrorReporting(service: string, dsn = process.env.ERROR_TRACKER_DSN) {
  if (!dsn) return;
  const next = sentrySink(dsn, service);
  if (!next) { log.warn("ERROR_TRACKER_DSN is set but not a valid DSN: errors are logged only"); return; }
  setErrorSink(next);
}
