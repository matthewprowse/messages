import { createHash, randomBytes } from "node:crypto";
import { accountsReady, ensureProfile, saveAccountRow, saveCredentials } from "@/lib/server/accounts";
import { fail, foreignOrigin, limiter, noStore, signedInUser } from "@/lib/server/request";

// Pairs Konva Relay on the user's Mac with their iCloud Reminders account. A new token is made each time and
// shown once; only its SHA-256 is stored, as the account's credentials, so the worker can recognise the relay
// (apps/worker/src/reminders/server.ts) but nobody can read the token back. Making a new one replaces the old,
// which stops working as soon as the worker restarts the account. No Apple ID password is ever involved.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Where the relay reaches the worker. The worker listens on RELAY_PORT; outside this machine, a TLS proxy in front.
const RELAY_URL = process.env.RELAY_PUBLIC_URL || "http://localhost:8790";

const overLimit = limiter(5, 10 * 60_000);

export async function POST(request: Request) {
  if (!accountsReady()) return fail(503, "Connecting iCloud Reminders is not set up on this server yet.");
  if (foreignOrigin(request)) return fail(403, "Not allowed from this site.");
  const user = await signedInUser(request);
  if (!user) return fail(401, "Sign in first.");
  const wait = overLimit(user.id);
  if (wait > 0) return fail(429, "Too many tries. Wait a few minutes and try again.", { "Retry-After": String(wait) });

  const token = `konva_rr_${randomBytes(32).toString("base64url")}`;
  const tokenHash = createHash("sha256").update(token, "utf8").digest("hex");
  try {
    await ensureProfile(user.id);
    // One Reminders account per person, found again by their sign-in email, so a new token replaces the old.
    const accountId = await saveAccountRow(user.id, "icloud_reminders", "iCloud Reminders", (user.email ?? user.id).toLowerCase());
    await saveCredentials(accountId, { tokenHash });
  } catch {
    return fail(500, "The relay token could not be saved. Try again.");
  }
  return Response.json({ token, relayUrl: RELAY_URL }, { headers: noStore });
}
