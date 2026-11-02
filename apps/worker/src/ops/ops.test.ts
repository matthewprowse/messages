// Tests for the worker's ops modules: readiness, the health responses, the content-free error report and tracker
// envelope, and the counters.

import assert from "node:assert/strict";
import { test } from "node:test";
import { describe, envelopeFor, framesOf, parseDsn, reportError, sentrySink, setErrorSink, trimPath, type ErrorReport } from "./errors";
import { createHealth, healthPort, readiness } from "./health";
import { count, countSend, renderPrometheus, resetMetrics, safeLabel, seriesKey, snapshot } from "./metrics";

test("not ready before the first tick, or without the lease, or when the loop went quiet", () => {
  const base = { now: 1_000_000, startedAt: 0, leaseHeld: true, lastTickAt: 990_000 };
  assert.equal(readiness(base).ready, true);
  assert.deepEqual(readiness({ ...base, lastTickAt: null }).reasons, ["no_tick_yet"]);
  assert.deepEqual(readiness({ ...base, leaseHeld: false }).reasons, ["lease_not_held"]);
  assert.deepEqual(readiness({ ...base, lastTickAt: 800_000 }).reasons, ["tick_stale"]);
  assert.equal(readiness({ ...base, lastTickAt: 800_000, maxTickAgeMs: 300_000 }).ready, true);
});

test("liveness answers 200, readiness follows the clock and the lease, unknown paths 404", () => {
  let t = 0;
  const h = createHealth({ now: () => t });
  assert.equal(h.respond("/healthz").status, 200);
  assert.equal(h.respond("/readyz").status, 503);
  t = 5_000;
  h.tick();
  assert.equal(h.respond("/readyz").status, 200);
  h.setLeaseHeld(false);
  const lost = h.respond("/readyz");
  assert.equal(lost.status, 503);
  assert.deepEqual(JSON.parse(lost.body).reasons, ["lease_not_held"]);
  h.setLeaseHeld(true);
  t = 200_000;
  assert.equal(h.respond("/readyz").status, 503);
  assert.equal(h.respond("/nope").status, 404);
});

test("the health port is off unless it is a real port", () => {
  assert.equal(healthPort(undefined), null);
  assert.equal(healthPort("off"), null);
  assert.equal(healthPort("abc"), null);
  assert.equal(healthPort("70000"), null);
  assert.equal(healthPort("8080"), 8080);
});

test("frames keep function, trimmed file and position, and never the message line", () => {
  const stack = ["Error: could not reach anna@example.com about the invoice", "    at sendOne (/Users/someone/dev/Messages/apps/worker/src/send/outbox.ts:42:7)", "    at async run (file:///app/apps/worker/src/index.ts:10:3)", "    at /Users/someone/x/node_modules/foo/index.js:1:2", "    at node:internal/process/task_queues:105:5"].join("\n");
  const frames = framesOf(stack);
  assert.deepEqual(frames[0], { fn: "sendOne", file: "apps/worker/src/send/outbox.ts", line: 42, col: 7 });
  assert.equal(frames[1].fn, "run");
  assert.equal(frames[2].file, "node_modules/foo/index.js");
  assert.equal(frames[3].file, "node:internal/process/task_queues");
  assert.ok(!JSON.stringify(frames).includes("anna"));
  assert.ok(!JSON.stringify(frames).includes("someone"));
  assert.equal(trimPath("/home/u/script.js"), "script.js");
});

test("a report carries the code and class but never the message", () => {
  const err = Object.assign(new Error("failed for bob@example.com: hello there"), { code: "ECONNRESET" });
  const r = describe(err, "reconcile");
  assert.equal(r.code, "ECONNRESET");
  assert.equal(r.cls, "Error");
  assert.ok(!JSON.stringify(r).includes("bob"));
  // A code that is free text is not allowed to become a label.
  assert.equal(describe({ code: "bob@example.com wrote" }, "x").code, "other");
});

test("reporting counts the failure, forwards once a minute per place and code, and never throws", () => {
  resetMetrics();
  const seen: ErrorReport[] = [];
  setErrorSink({ capture: (r) => seen.push(r) });
  const quiet = console.error;
  console.error = () => {};
  try {
    const err = Object.assign(new Error("secret text"), { code: "E1" });
    reportError(err, "loop", 1_000_000);
    reportError(err, "loop", 1_030_000);
    reportError(err, "loop", 1_070_000);
    reportError(err, "other_loop", 1_070_000);
  } finally {
    console.error = quiet;
    setErrorSink(null);
  }
  assert.equal(seen.length, 3);
  assert.equal(snapshot()["failures{code=E1,where=loop}"], 3);
  setErrorSink({ capture: () => { throw new Error("tracker bug"); } });
  const quiet2 = console.error;
  console.error = () => {};
  try { assert.doesNotThrow(() => reportError(new Error("x"), "loop", 9_999_999)); } finally { console.error = quiet2; setErrorSink(null); }
});

test("a DSN becomes an envelope URL and key, and a bad one is refused", () => {
  assert.deepEqual(parseDsn("https://abc123@o1.ingest.example.io/456"), { url: "https://o1.ingest.example.io/api/456/envelope/", key: "abc123" });
  assert.equal(parseDsn("https://o1.ingest.example.io/456"), null);
  assert.equal(parseDsn("not a url"), null);
  assert.equal(parseDsn("ftp://k@h/1"), null);
  assert.equal(sentrySink("garbage", "worker"), null);
});

test("the tracker envelope holds the code, place and frames only", () => {
  const report: ErrorReport = { code: "ECONNRESET", cls: "Error", where: "reconcile", frames: [{ fn: "a", file: "apps/worker/src/a.ts", line: 1, col: 2 }, { fn: "b", file: "apps/worker/src/b.ts", line: 3, col: 4 }] };
  const [header, kind, body] = envelopeFor(report, "worker", "https://k@h/1", 1_700_000_000_000, "f".repeat(32)).split("\n").map((l) => JSON.parse(l));
  assert.equal(header.event_id, "f".repeat(32));
  assert.equal(kind.type, "event");
  assert.equal(body.exception.values[0].value, "ECONNRESET");
  assert.equal(body.exception.values[0].stacktrace.frames[0].function, "b", "Sentry wants the oldest frame first");
  assert.deepEqual(Object.keys(body).sort(), ["event_id", "exception", "level", "logger", "platform", "tags", "timestamp"]);
});

test("the sink posts the envelope to the tracker with the public key", async () => {
  const calls: { url: string; init: RequestInit }[] = [];
  const sink = sentrySink("https://abc@h.example/7", "worker", (async (url: string, init: RequestInit) => { calls.push({ url, init }); return new Response("{}"); }) as unknown as typeof fetch);
  sink?.capture({ code: "X", cls: "Error", where: "w", frames: [] });
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(calls[0].url, "https://h.example/api/7/envelope/");
  assert.match(String((calls[0].init.headers as Record<string, string>)["x-sentry-auth"]), /sentry_key=abc/);
});

test("counters are keyed by sorted, code-like labels and rendered for Prometheus", () => {
  resetMetrics();
  assert.equal(seriesKey("sends", { outcome: "ok", channel: "gmail" }), "sends{channel=gmail,outcome=ok}");
  assert.equal(safeLabel("anna@example.com"), "other");
  assert.equal(safeLabel(undefined), "other");
  countSend("gmail", "ok");
  countSend("gmail", "ok");
  count("plain");
  assert.equal(snapshot()["sends{channel=gmail,outcome=ok}"], 2);
  const text = renderPrometheus();
  assert.match(text, /konva_sends\{channel="gmail",outcome="ok"\} 2/);
  assert.match(text, /konva_plain 1/);
});
