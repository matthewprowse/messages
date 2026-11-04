// Liveness and readiness for the supervisor (Docker, Cloud Run, a Confidential Space VM). Liveness only says the process
// answers. Readiness says the worker is doing its job: it holds its shard lease and its main loop ticked recently, so a
// worker that hangs, or lost its lease, is taken out of rotation and restarted. The decision is a pure function so it can be
// tested; the HTTP server is a thin wrapper. Nothing here reports content, only booleans and ages in seconds.

import { createServer, type Server } from "node:http";
import { renderPrometheus } from "./metrics";

/** The main loop (a 30 second reconcile) must have ticked within this long, which tolerates a few missed turns. */
export const MAX_TICK_AGE_MS = 120_000;

export interface HealthInput {
  now: number;
  startedAt: number;
  leaseHeld: boolean;
  /** When the main loop last completed a turn, or null before the first. */
  lastTickAt: number | null;
  maxTickAgeMs?: number;
}

export interface Readiness {
  ready: boolean;
  /** Fixed reason codes, empty when ready. */
  reasons: string[];
  uptimeS: number;
  lastTickAgeS: number | null;
}

export function readiness(i: HealthInput): Readiness {
  const max = i.maxTickAgeMs ?? MAX_TICK_AGE_MS;
  const reasons: string[] = [];
  if (!i.leaseHeld) reasons.push("lease_not_held");
  if (i.lastTickAt === null) reasons.push("no_tick_yet");
  else if (i.now - i.lastTickAt > max) reasons.push("tick_stale");
  return {
    ready: reasons.length === 0,
    reasons,
    uptimeS: Math.max(0, Math.round((i.now - i.startedAt) / 1000)),
    lastTickAgeS: i.lastTickAt === null ? null : Math.max(0, Math.round((i.now - i.lastTickAt) / 1000)),
  };
}

/** The port from HEALTH_PORT, or null when unset, "off" or not a port: the endpoint is then not started (local development). */
export function healthPort(raw: string | undefined): number | null {
  if (!raw || raw === "off") return null;
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 && n < 65536 ? n : null;
}

export interface Health {
  /** The main loop completed a turn. */
  tick(): void;
  setLeaseHeld(held: boolean): void;
  respond(path: string): { status: number; type: string; body: string };
}

export function createHealth(opts: { now?: () => number; maxTickAgeMs?: number; leaseHeld?: boolean } = {}): Health {
  const now = opts.now ?? Date.now;
  const startedAt = now();
  let lastTickAt: number | null = null;
  let leaseHeld = opts.leaseHeld ?? true;
  return {
    tick: () => { lastTickAt = now(); },
    setLeaseHeld: (held) => { leaseHeld = held; },
    respond(path) {
      const json = (status: number, body: unknown) => ({ status, type: "application/json", body: JSON.stringify(body) });
      if (path === "/healthz") return json(200, { alive: true });
      if (path === "/readyz") {
        const r = readiness({ now: now(), startedAt, leaseHeld, lastTickAt, maxTickAgeMs: opts.maxTickAgeMs });
        return json(r.ready ? 200 : 503, r);
      }
      if (path === "/metrics") return { status: 200, type: "text/plain; version=0.0.4", body: renderPrometheus() };
      return json(404, { error: "not_found" });
    },
  };
}

/**
 * Starts the endpoint on loopback by default: the image's HEALTHCHECK probes from inside the container and nothing is
 * published, so no other container or host needs it. A supervisor that probes from outside (Cloud Run, a Confidential
 * Space VM) sets HEALTH_HOST=0.0.0.0. Read only, GET only.
 */
export function startHealthServer(health: Health, port: number, host = process.env.HEALTH_HOST?.trim() || "127.0.0.1"): Server {
  const server = createServer((req, res) => {
    const out = req.method === "GET" ? health.respond((req.url ?? "/").split("?")[0]) : { status: 405, type: "application/json", body: '{"error":"method_not_allowed"}' };
    res.writeHead(out.status, { "content-type": out.type, "cache-control": "no-store" });
    res.end(out.body);
  });
  server.listen(port, host);
  server.unref(); // never keeps the process alive on its own
  return server;
}
