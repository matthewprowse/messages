import { dataKey, keysReady } from "@/lib/server/keys";
import { fail, foreignOrigin, limiter, noStore, signedInUser } from "@/lib/server/request";

// Hands a signed-in user their data key, so the browser can decrypt their messages itself. The caller
// proves who they are with their Supabase access token; the key is unwrapped here with KEY_WRAPPING_KEY and
// never stored on this server. In Phase 2A this moves into Confidential Space with the workers.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// 30 requests a minute. A browser fetches its key once per session, so anything faster is a script.
const overLimit = limiter(30, 60_000);

export async function POST(request: Request) {
  if (!keysReady()) return fail(503, "The key service is not set up.");
  if (foreignOrigin(request)) return fail(403, "Not allowed from this site.");
  const user = await signedInUser(request);
  if (!user) return fail(401, "Sign in first.");
  const wait = overLimit(user.id);
  if (wait > 0) return fail(429, "Too many requests. Try again shortly.", { "Retry-After": String(wait) });
  try {
    const key = await dataKey(user.id);
    return Response.json({ key: Buffer.from(key).toString("base64") }, { headers: noStore });
  } catch {
    return fail(500, "Could not open your key.");
  }
}
