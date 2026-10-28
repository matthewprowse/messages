import { createClient, type User } from "@supabase/supabase-js";
import type { Database } from "@messages/db";

// What the server routes share: the service-role client, who is asking, where from, and how often.
// Server only: nothing here may be imported by a page.

const url = process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

export const admin = url && serviceKey ? createClient<Database>(url, serviceKey, { auth: { persistSession: false } }) : null;

export const noStore = { "Cache-Control": "no-store" };

/** True when the request names an Origin that is not this app. Requests with no Origin pass. */
export function foreignOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return false;
  try {
    return new URL(origin).host !== appHost(request);
  } catch {
    return true;
  }
}

/** This app's host as the browser sees it, behind a proxy too. */
export function appHost(request: Request): string {
  return request.headers.get("x-forwarded-host") ?? request.headers.get("host") ?? new URL(request.url).host;
}

/** This app's origin as the browser sees it, e.g. https://app.example.com. */
export function appOrigin(request: Request): string {
  const proto = request.headers.get("x-forwarded-proto") ?? new URL(request.url).protocol.replace(":", "");
  return `${proto}://${appHost(request)}`;
}

/** The signed-in user, proven by the Supabase access token in the Authorization header, or null. */
export async function signedInUser(request: Request): Promise<User | null> {
  if (!admin) return null;
  const token = request.headers.get("authorization")?.match(/^Bearer\s+(\S+)$/i)?.[1];
  if (!token) return null;
  const { data, error } = await admin.auth.getUser(token);
  return error ? null : data.user;
}

/** The caller's address. On Vercel the platform sets x-vercel-forwarded-for (and overwrites x-forwarded-for), so a client cannot choose it; elsewhere the last x-forwarded-for entry is the one the nearest proxy added. */
export function clientAddress(request: Request): string {
  const vercel = request.headers.get("x-vercel-forwarded-for")?.split(",")[0]?.trim();
  if (vercel) return vercel;
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
}

/**
 * A fixed-window limit shared by every server instance, kept in Postgres (rate_limit_hit, migration
 * 20261102200000). The returned function counts one request and resolves to the seconds to wait when over the
 * limit, otherwise 0. If the database cannot be reached it fails closed (a wait of 60 seconds) unless
 * fallbackToMemory is set, which counts in this instance's memory.
 */
export function limiter(limit: number, windowMs: number, options: LimiterOptions = {}) {
  const memory = memoryLimiter(limit, windowMs);
  const seconds = Math.max(1, Math.round(windowMs / 1000));
  const name = options.name ?? `${limit}/${seconds}`;
  return async (id: string): Promise<number> => {
    const key = `${name}:${id}`.slice(0, 200);
    try {
      if (!admin) throw new Error("no database client");
      const rpc = admin.rpc as unknown as (fn: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: unknown }>;
      const { data, error } = await rpc.call(admin, "rate_limit_hit", { p_key: key, p_limit: limit, p_window_seconds: seconds });
      if (error || typeof data !== "number") throw new Error("rate limit call failed");
      return data;
    } catch {
      return options.fallbackToMemory ? memory(key) : 60;
    }
  };
}

export function fail(status: number, error: string, headers: Record<string, string> = {}) {
  return Response.json({ error }, { status, headers: { ...noStore, ...headers } });
}
