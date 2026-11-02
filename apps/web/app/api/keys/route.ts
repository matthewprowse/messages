// Hands a signed-in user their data key, so the browser can decrypt their messages itself. The caller
// proves who they are with their Supabase access token; the key is unwrapped here (Cloud KMS, or KEY_WRAPPING_KEY) and
// never stored on this server. In Phase 2A this moves into Confidential Space with the workers.
//
// A member of a team also gets the team's keys, only while their workspace_members row is active, so a
// removed member's next load has none. The reply is { key, team: Team | null } where Team is
//   { workspaceId, key, version, versions: [{ version, key }], indexKey }
// key and version are the current team key (what new values are sealed with). versions lists every version still
// holding values, newest first (current included): a value sealed before the last rotation opens with an older one
// until apps/worker/src/share/rotate.ts has re-sealed it, and a browser tries them in order. indexKey is the first
// version's key, which the team's blind indexes always use (see TeamKeyring in packages/crypto/src/wrap.ts).
// Asking also makes the next version first when a member has been removed since the current one was made.

import { activeWorkspaceId, dataKey, keysReady, teamKeys } from "@/lib/server/keys";
import { fail, foreignOrigin, limiter, noStore, signedInUser } from "@/lib/server/request";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// 30 requests a minute. A browser fetches its key once per session, so anything faster is a script.
const overLimit = limiter(30, 60_000, { name: "keys" });

export async function POST(request: Request) {
  if (!keysReady()) return fail(503, "The key service is not set up.");
  if (foreignOrigin(request)) return fail(403, "Not allowed from this site.");
  const user = await signedInUser(request);
  if (!user) return fail(401, "Sign in first.");
  const wait = await overLimit(user.id);
  if (wait > 0) return fail(429, "Too many requests. Try again shortly.", { "Retry-After": String(wait) });
  try {
    const [key, team] = await Promise.all([dataKey(user.id), teamOf(user.id)]);
    return Response.json({ key: Buffer.from(key).toString("base64"), team }, { headers: noStore });
  } catch {
    return fail(500, "Could not open your key.");
  }
}

// The caller's team keys, or null when they have no active team. A failure here (the workspaces tables not
// there yet, a database hiccup) leaves out the team keys rather than their own: nobody loses their own
// messages over it, and the browser asks again on its next load.
interface TeamReply {
  workspaceId: string;
  key: string;
  version: number;
  versions: { version: number; key: string }[];
  indexKey: string;
}

async function teamOf(userId: string): Promise<TeamReply | null> {
  try {
    const workspaceId = await activeWorkspaceId(userId);
    if (!workspaceId) return null;
    const ring = await teamKeys(workspaceId);
    const b64 = (k: Uint8Array) => Buffer.from(k).toString("base64");
    return {
      workspaceId,
      key: b64(ring.current.key),
      version: ring.current.version,
      versions: ring.all.map((k) => ({ version: k.version, key: b64(k.key) })),
      indexKey: b64(ring.indexRoot.key),
    };
  } catch (err) {
    // Code only: the message could carry a row. The browser asks again on its next load.
    console.warn("keys: team keys left out", { code: (err as { code?: string } | null)?.code ?? "UNKNOWN" });
    return null;
  }
}
