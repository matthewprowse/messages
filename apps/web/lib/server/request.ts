// What the server routes share: the service-role client, who is asking, where from, and how often.
// Server only: nothing here may be imported by a page.

import { createClient, type User } from "@supabase/supabase-js";
import type { Database } from "@messages/db";
import { keyAccess, tokenAal } from "./key-policy";

const url = process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

export const admin = url && serviceKey ? createClient<Database>(url, serviceKey, { auth: { persistSession: false } }) : null;

export const noStore = { "Cache-Control": "no-store" };

type Env = Record<string, string | undefined>;

/** True in a production build (Vercel production, or any NODE_ENV=production build, previews included), where request headers must never decide this app's own address. */
export function isProduction(env: Env = process.env): boolean {
  return env.VERCEL_ENV === "production" || env.NODE_ENV === "production";
}

/**
 * True when the request names an Origin that is not this app. Requests with no Origin pass. In a preview either of the
 * deployment's own addresses is ours. Fails closed: when this app's own origin is unknown (production without APP_URL),
 * any Origin is foreign.
 */
export function foreignOrigin(request: Request, env: Env = process.env): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return false;
  try {
    const host = new URL(origin).host;
    return !previewHosts(env).includes(host) && host !== appHost(request, env);
  } catch {
    return true;
  }
}

/** This app's host, e.g. app.example.com. Throws where appOrigin does. */
export function appHost(request: Request, env: Env = process.env): string {
  return new URL(appOrigin(request, env)).host;
}

/**
 * The hosts a Vercel preview deployment answers on: its own deployment address and its branch address, both set by Vercel
 * (a client cannot choose them). Empty outside a preview.
 */
function previewHosts(env: Env): string[] {
  if (env.VERCEL_ENV !== "preview") return [];
  return [env.VERCEL_BRANCH_URL, env.VERCEL_URL].map((h) => h?.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/+$/, "") ?? "").filter((h) => /^[a-z0-9.-]+(:\d+)?$/.test(h));
}

/**
 * This app's origin, e.g. https://app.example.com. It decides OAuth redirect addresses, where callbacks send the
 * browser, whether cookies are Secure and which Origin is ours, so it never comes from Host or X-Forwarded-Host alone,
 * which a proxy in front may pass through from the client:
 * - A Vercel preview runs on its own *.vercel.app addresses, so APP_URL (the production domain) would refuse every
 *   browser request there. It uses the address the request came in on when that is one of the preview's own (deployment
 *   or branch), else the branch address. Throws when Vercel set neither.
 * - Production otherwise (VERCEL_ENV production, or any NODE_ENV=production build) requires APP_URL and throws without it.
 * - Locally (pnpm dev) APP_URL when set, else the request's own headers.
 */
export function appOrigin(request: Request, env: Env = process.env): string {
  const preview = previewHosts(env);
  if (preview.length > 0) {
    const asked = (request.headers.get("host") ?? "").trim().toLowerCase();
    return `https://${preview.includes(asked) ? asked : preview[0]}`;
  }
  if (env.VERCEL_ENV === "preview") throw new Error("VERCEL_URL is missing in this preview deployment.");
  const fixed = env.APP_URL?.trim().replace(/\/+$/, "");
  if (fixed && /^https?:\/\/[^/]+$/.test(fixed)) return fixed;
  if (isProduction(env)) throw new Error("APP_URL must be set to this app's origin in production.");
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host") ?? new URL(request.url).host;
  const proto = request.headers.get("x-forwarded-proto") ?? new URL(request.url).protocol.replace(":", "");
  return `${proto}://${host}`;
}

/** The bearer token in the Authorization header, or "" when there is none. */
export function bearerToken(request: Request): string {
  return request.headers.get("authorization")?.match(/^Bearer\s+(\S+)$/i)?.[1] ?? "";
}

/**
 * The signed-in user, proven by the Supabase access token in the Authorization header, or null. A user with a verified
 * second factor of any kind (authenticator app, phone, passkey) counts only with an aal2 session, one that passed the
 * code check: otherwise a stolen password or magic link alone could connect accounts, change sign-ins or cancel a
 * deletion. Every route that acts for a user goes through here, so none can forget the check.
 */
export async function signedInUser(request: Request): Promise<User | null> {
  if (!admin) return null;
  const token = bearerToken(request);
  if (!token) return null;
  const { data, error } = await admin.auth.getUser(token);
  if (error) return null;
  return keyAccess(data.user.factors, tokenAal(token)).ok ? data.user : null;
}

/**
 * The caller's address, for rate limits. Production runs on Vercel, which sets x-vercel-forwarded-for itself (a client
 * cannot choose it), so there nothing else is trusted: without it the answer is "unknown" and per-address limits are
 * skipped rather than keyed on a header the client wrote. Locally, or self-hosted behind one known proxy, x-real-ip or
 * the last x-forwarded-for entry (the one the nearest proxy added) is used.
 */
export function clientAddress(request: Request, env: Env = process.env): string {
  const vercel = request.headers.get("x-vercel-forwarded-for")?.split(",")[0]?.trim();
  if (vercel) return vercel;
  if (isProduction(env)) return "unknown";
  const real = request.headers.get("x-real-ip")?.trim();
  if (real) return real;
  const chain = request.headers.get("x-forwarded-for")?.split(",");
  return chain?.[chain.length - 1]?.trim() || "unknown";
}

/** The in-memory fixed window: one counter per key for this server instance only. */
function memoryLimiter(limit: number, windowMs: number) {
  const hits = new Map<string, { count: number; resetAt: number }>();
  return (key: string, now = Date.now()): number => {
    if (hits.size > 1000) for (const [id, h] of hits) if (h.resetAt <= now) hits.delete(id);
    const hit = hits.get(key);
    if (!hit || hit.resetAt <= now) {
      hits.set(key, { count: 1, resetAt: now + windowMs });
      return 0;
    }
    hit.count += 1;
    return hit.count > limit ? Math.ceil((hit.resetAt - now) / 1000) : 0;
  };
}

interface LimiterOptions {
  /** Names the counter in the database. Limiters with the same name, limit and window share counts. Defaults to the limit and window. */
  name?: string;
  /** When the database call fails, count in this instance's memory instead of refusing. Off by default: a failed check refuses the request. Only for public, low-risk routes. */
  fallbackToMemory?: boolean;
  /** Also count per client address, with this limit in the same window, when the call passes the request. Stops many accounts from one address using a route as a relay. */
  perAddress?: number;
}

/**
 * A fixed-window limit shared by every server instance, kept in Postgres (rate_limit_hit, migration
 * 20261102200000). The returned function counts one request and resolves to the seconds to wait when over the
 * limit, otherwise 0. If the database cannot be reached it fails closed (a wait of 60 seconds) unless
 * fallbackToMemory is set, which counts in this instance's memory.
 */
export function limiter(limit: number, windowMs: number, options: LimiterOptions = {}) {
  const memory = memoryLimiter(limit, windowMs);
  const addressMemory = memoryLimiter(options.perAddress ?? limit, windowMs);
  const seconds = Math.max(1, Math.round(windowMs / 1000));
  const name = options.name ?? `${limit}/${seconds}`;
  const hit = async (key: string, max: number, inMemory: (key: string) => number): Promise<number> => {
    try {
      if (!admin) throw new Error("no database client");
      const rpc = admin.rpc as unknown as (fn: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: unknown }>;
      const { data, error } = await rpc.call(admin, "rate_limit_hit", { p_key: key, p_limit: max, p_window_seconds: seconds });
      if (error || typeof data !== "number") throw new Error("rate limit call failed");
      return data;
    } catch {
      return options.fallbackToMemory ? inMemory(key) : 60;
    }
  };
  return async (id: string, request?: Request): Promise<number> => {
    const byUser = await hit(`${name}:${id}`.slice(0, 200), limit, memory);
    if (!request || !options.perAddress) return byUser;
    const address = clientAddress(request);
    if (address === "unknown") return byUser;
    const byAddress = await hit(`${name}:ip:${address}`.slice(0, 200), options.perAddress, addressMemory);
    return Math.max(byUser, byAddress);
  };
}

const MAX_BODY = 16 * 1024; // bytes

/**
 * The body as text, or null when it is over maxBytes. A Content-Length over the cap is refused before anything is read,
 * and a body without one is read only up to the cap, so a client cannot make the server hold more than that in memory.
 */
export async function readCapped(request: Request, maxBytes: number): Promise<string | null> {
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(declared) && declared > maxBytes) return null;
  if (!request.body) return "";
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) {
      await reader.cancel().catch(() => undefined);
      return null;
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString("utf8");
}

/** The JSON object in a request body, or null when it is missing, too big (over 16 KB), not JSON or not an object. */
export async function readJson(request: Request): Promise<Record<string, unknown> | null> {
  try {
    const text = await readCapped(request, MAX_BODY);
    if (text === null) return null;
    const value: unknown = JSON.parse(text);
    return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** A string field of a parsed body: the string, "" when it is missing, or null when it is there but not a string. */
export function textField(body: Record<string, unknown>, key: string): string | null {
  const value = body[key];
  if (value === undefined) return "";
  return typeof value === "string" ? value : null;
}

export function fail(status: number, error: string, headers: Record<string, string> = {}) {
  return Response.json({ error }, { status, headers: { ...noStore, ...headers } });
}
