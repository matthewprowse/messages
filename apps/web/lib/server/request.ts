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

/**
 * A simple per-user limit, kept in this server's memory. Each server instance counts for itself, which is
 * enough to stop a script. The returned function counts one request and gives the seconds to wait when over
 * the limit, otherwise 0.
 */
export function limiter(limit: number, windowMs: number) {
  const hits = new Map<string, { count: number; resetAt: number }>();
  return (userId: string, now = Date.now()): number => {
    if (hits.size > 1000) for (const [id, h] of hits) if (h.resetAt <= now) hits.delete(id);
    const hit = hits.get(userId);
    if (!hit || hit.resetAt <= now) {
      hits.set(userId, { count: 1, resetAt: now + windowMs });
      return 0;
    }
    hit.count += 1;
    return hit.count > limit ? Math.ceil((hit.resetAt - now) / 1000) : 0;
  };
}

export function fail(status: number, error: string, headers: Record<string, string> = {}) {
  return Response.json({ error }, { status, headers: { ...noStore, ...headers } });
}
