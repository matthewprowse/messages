// Hands a signed-in user their data key, so the browser can decrypt their messages itself. The caller
// proves who they are with their Supabase access token; the key is unwrapped here (Cloud KMS, or KEY_WRAPPING_KEY) and
// never stored on this server. In Phase 2A this moves into Confidential Space with the workers.
//
// A member of a team also gets the team's keys, only while their workspace_members row is active, so a
// removed member's next load has none. The reply is { key, team: Team | null } where Team is
//   { workspaceId, key, version, versions: [{ version, key }], indexKey }
// key and version are the current team key (what new values are sealed with). versions lists every version still
// holding values, newest first (current included): a value sealed before the last rotation opens with an older one
// until apps/worker/src/share/rotate.ts has re-sealed it, and a browser tries them in order. indexHmacKey is the team's
// index key itself, stored apart (team_keys.index_wrapped_key), used as it is; until the worker has stored it, indexKey
// is the first version's data key instead and the browser derives the index key from it (TeamKeyring in
// packages/crypto/src/wrap.ts). Exactly one of the two is set.
// Asking also makes the next version first when a member has been removed since the current one was made.
//
// The user's own key comes the same way when it is being rotated (apps/worker/src/rekey): `key` is the current data key
// (it seals), `older` the other keys still holding values (they only open, base64, may be empty), and `indexKey` the raw
// index key their blind indexes keep, or null when `key` still makes them (packages/crypto deriveUserKeyring).

import { zeroKeyring } from "@messages/crypto/wrap";
import { activeWorkspaceId, keyring, keysReady, teamKeys } from "@/lib/server/keys";
import { keyAccess, tokenAal } from "@/lib/server/key-policy";
import { bearerToken, fail, foreignOrigin, limiter, noStore, signedInUser } from "@/lib/server/request";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// 30 requests a minute. A browser fetches its key once per session, so anything faster is a script.
const overLimit = limiter(30, 60_000, { name: "keys" });

export async function POST(request: Request) {
  if (!keysReady()) return fail(503, "The key service is not set up.");
  if (foreignOrigin(request)) return fail(403, "Not allowed from this site.");
  const user = await signedInUser(request);
  if (!user) return fail(401, "Sign in first.");
  // A user with a verified second factor needs an aal2 session: a password or email link alone must not open their messages.
  // signedInUser already refuses such a session for every route; checked again here because this route hands out the key.
  const access = keyAccess(user.factors, tokenAal(bearerToken(request)));
  if (!access.ok) return fail(access.status, access.message);
  // The count runs beside the key reads rather than before them, saving a round trip, and is keyed by the verified id only:
  // counting before getUser would mean trusting the token's unverified sub, so a forged token could use up someone
  // else's allowance. Nothing is returned until the count has passed.
  const [wait, keys] = await Promise.all([
    overLimit(user.id),
    Promise.all([keyring(user.id), teamOf(user.id)]).catch(() => null),
  ]);
  if (wait > 0) {
    if (keys) zeroKeyring(keys[0]);
    return fail(429, "Too many requests. Try again shortly.", { "Retry-After": String(wait) });
  }
  if (!keys) return fail(500, "Could not open your key.");
  const [ring, team] = keys;
  const b64 = (k: Uint8Array) => Buffer.from(k).toString("base64");
  const body = { key: b64(ring.current), older: ring.older.map(b64), indexKey: ring.indexKey ? b64(ring.indexKey) : null, team };
  zeroKeyring(ring);
  return Response.json(body, { headers: noStore });
}

// The caller's team keys, or null when they have no active team. A failure here (the workspaces tables not
// there yet, a database hiccup) leaves out the team keys rather than their own: nobody loses their own
// messages over it, and the browser asks again on its next load.
interface TeamReply {
  workspaceId: string;
  key: string;
  version: number;
  versions: { version: number; key: string }[];
  indexKey: string | null;
  indexHmacKey: string | null;
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
      indexKey: ring.indexRoot.derived ? null : b64(ring.indexRoot.key),
      indexHmacKey: ring.indexRoot.derived ? b64(ring.indexRoot.key) : null,
    };
  } catch (err) {
    // Code only: the message could carry a row. The browser asks again on its next load.
    console.warn("keys: team keys left out", { code: (err as { code?: string } | null)?.code ?? "UNKNOWN" });
    return null;
  }
}
