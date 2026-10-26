import { createHash } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { errorCode, log } from "../log";
import { parseReport, parseSync, type RelaySync, type RelayUpdate } from "./protocol";

// The endpoint Konva Relay talks to (protocol.ts). It listens on RELAY_PORT, on this machine only unless
// RELAY_HOST says otherwise, so anything reaching it from outside goes through a TLS proxy in front. A relay
// is known only by its token: the token's hash finds the running iCloud Reminders connector it belongs to,
// and that connector writes only to its own account's tasks. Each token has its own rate limits, and
// requests with a wrong token are limited by address, so tokens cannot be guessed at speed.

const MAX_BODY = 8 * 1024 * 1024; // a sync of MAX_REMINDERS fits well inside
const MAX_WAIT_S = 25; // a long poll for changes is held at most this long

/** What a running iCloud Reminders connector does for its relay. */
export interface RelayAccount {
  sync(sync: RelaySync): Promise<{ stored: number; removed: number }>;
  /** The changes queued for this account, waiting up to waitMs for one when there are none. */
  updates(waitMs: number, signal: AbortSignal): Promise<RelayUpdate[]>;
  /** Settles a queued change. False when it is not this account's, or no longer queued. */
  report(id: string, result: { ok: true } | { ok: false; error: string }): Promise<boolean>;
}

/** How a relay token is kept: only its SHA-256, so a leaked credentials row cannot be used as a token. */
export function relayTokenHash(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

/** A count per key in this process's memory, like the web app's: the seconds to wait when over, else 0. */
export function limiter(limit: number, windowMs: number) {
  const hits = new Map<string, { count: number; resetAt: number }>();
  return (key: string, now = Date.now()): number => {
    if (hits.size > 1000) for (const [k, h] of hits) if (h.resetAt <= now) hits.delete(k);
    const hit = hits.get(key);
    if (!hit || hit.resetAt <= now) {
      hits.set(key, { count: 1, resetAt: now + windowMs });
      return 0;
    }
    hit.count += 1;
    return hit.count > limit ? Math.ceil((hit.resetAt - now) / 1000) : 0;
  };
}

function reply(res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}) {
  if (res.headersSent || res.destroyed) return;
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...headers });
  res.end(JSON.stringify(body));
}

class TooLarge extends Error {}

async function readJson(req: IncomingMessage): Promise<unknown> {
  if (Number(req.headers["content-length"] ?? 0) > MAX_BODY) throw new TooLarge();
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > MAX_BODY) throw new TooLarge();
    chunks.push(chunk as Buffer);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    return undefined;
  }
}

const UPDATE_PATH = /^\/v1\/reminders\/updates\/([0-9a-f-]{36})$/i;

/** The request handler, apart from listening, so tests can drive it on any port. */
export function relayHandler(find: (tokenHash: string) => RelayAccount | undefined) {
  const wrongToken = limiter(10, 10 * 60_000); // per address
  const perToken = limiter(120, 60_000); // a relay long-polls, so about 3 a minute when idle
  const syncs = limiter(20, 60_000); // a sync per change on the Mac, debounced there

  return async (req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url ?? "/", "http://relay");
    const address = req.socket.remoteAddress ?? "unknown";
    const token = /^Bearer\s+(\S+)$/i.exec(req.headers.authorization ?? "")?.[1];
    const key = token ? relayTokenHash(token) : null;
    const account = key ? find(key) : undefined;
    if (!key || !account) {
      const wait = wrongToken(address);
      if (wait > 0) return reply(res, 429, { error: "rate_limited" }, { "retry-after": String(wait) });
      return reply(res, 401, { error: "unknown_token" });
    }
    const wait = perToken(key);
    if (wait > 0) return reply(res, 429, { error: "rate_limited" }, { "retry-after": String(wait) });

    try {
      if (url.pathname === "/v1/reminders/sync") {
        if (req.method !== "POST") return reply(res, 405, { error: "method" });
        const syncWait = syncs(key);
        if (syncWait > 0) return reply(res, 429, { error: "rate_limited" }, { "retry-after": String(syncWait) });
        const parsed = parseSync(await readJson(req));
        if (!parsed.ok) return reply(res, parsed.error === "too_large" ? 413 : 400, { error: parsed.error });
        return reply(res, 200, await account.sync(parsed.value));
      }
      if (url.pathname === "/v1/reminders/updates") {
        if (req.method !== "GET") return reply(res, 405, { error: "method" });
        const waitS = Math.min(MAX_WAIT_S, Math.max(0, Number(url.searchParams.get("wait") ?? 0) || 0));
        // A relay that hangs up stops the wait, so it is not answered into a closed socket.
        const gone = new AbortController();
        res.on("close", () => gone.abort());
        const updates = await account.updates(waitS * 1000, gone.signal);
        return reply(res, 200, { updates });
      }
      const update = UPDATE_PATH.exec(url.pathname);
      if (update) {
        if (req.method !== "POST") return reply(res, 405, { error: "method" });
        const parsed = parseReport(await readJson(req));
        if (!parsed.ok) return reply(res, 400, { error: parsed.error });
        const settled = await account.report(update[1].toLowerCase(), parsed.value);
        return settled ? reply(res, 200, { ok: true }) : reply(res, 404, { error: "not_found" });
      }
      return reply(res, 404, { error: "not_found" });
    } catch (err) {
      if (err instanceof TooLarge) return reply(res, 413, { error: "too_large" });
      log.warn("relay request failed", { path: url.pathname.replace(UPDATE_PATH, "/v1/reminders/updates/:id"), code: errorCode(err) });
      return reply(res, 500, { error: "server" });
    }
  };
}

/** Starts the relay endpoint. Resolves once it is listening. */
export function startRelayServer(options: { port: number; host: string; find: (tokenHash: string) => RelayAccount | undefined }): Promise<Server> {
  const handle = relayHandler(options.find);
  const server = createServer((req, res) => void handle(req, res));
  server.requestTimeout = 60_000; // above a long poll's MAX_WAIT_S
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(options.port, options.host, () => {
      server.off("error", reject);
      log.info("reminders relay listening", { host: options.host, port: options.port });
      resolve(server);
    });
  });
}
