import { accountsReady, ensureProfile, openAccountJson, saveAccountRow, sealAccountJson } from "@/lib/server/accounts";
import { admin, fail, foreignOrigin, limiter, noStore, signedInUser } from "@/lib/server/request";

// Connects a personal Instagram account from the app (Business and Creator accounts sign in with Instagram
// instead, see ./official). The username and password are stored encrypted, as iCloud's are, and the
// Instagram connector (pnpm instagram, in apps/ai) signs in with them within seconds: instagrapi lives in
// Python and has to keep one client open through any code Instagram asks for, so the sign-in happens there,
// not here. The password is dropped once it has been used. Any session and device saved by an earlier sign-in
// are kept, so Instagram keeps seeing the same phone. Nothing typed here is logged or sent back.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const USERNAME = /^[a-z0-9._]{1,30}$/;

// Each try may become a sign-in to Instagram, which watches for many of them, so few: 5 an hour.
const overLimit = limiter(5, 60 * 60_000);

interface Body {
  username?: string;
  password?: string;
}

export async function POST(request: Request) {
  if (!accountsReady()) return fail(503, "Connecting Instagram is not set up on this server yet.");
  if (foreignOrigin(request)) return fail(403, "Not allowed from this site.");
  const user = await signedInUser(request);
  if (!user || !admin) return fail(401, "Sign in first.");

  const body = (await request.json().catch(() => ({}))) as Body;
  const username = (body.username ?? "").trim().replace(/^@/, "").toLowerCase();
  const password = body.password ?? "";
  if (!USERNAME.test(username)) return fail(400, "Enter your Instagram username, without the @.");
  if (password.length < 6 || password.length > 200) return fail(400, "Enter your Instagram password.");
  const wait = await overLimit(user.id);
  if (wait > 0) return fail(429, "Too many tries. Wait a while before connecting again.", { "Retry-After": String(wait) });

  try {
    await ensureProfile(user.id);
    const accountId = await saveAccountRow(user.id, "instagram", "Instagram", username);
    // A sign-in step left over from an earlier try is cleared, so the app never shows a stale one.
    await admin.from("instagram_sign_ins").delete().eq("account_id", accountId);
    const { error: statusError } = await admin.from("accounts").update({ status_detail: "Signing in to Instagram." }).eq("id", accountId);
    if (statusError) throw statusError;
    await saveSignIn(accountId, username, password);
    return Response.json({ accountId }, { headers: noStore });
  } catch {
    return fail(500, "Instagram could not be connected. Try again.");
  }
}

/** The sign-in, keeping the connector's saved session (refreshed) with its fixed device. */
async function saveSignIn(accountId: string, username: string, password: string) {
  if (!admin) throw new Error("Supabase is not set up.");
  const { data: existing } = await admin.from("account_credentials").select("ciphertext, refreshed").eq("account_id", accountId).maybeSingle();
  let refreshed = existing?.refreshed ?? null;
  // A proxy set for this account (by the operator, in its stored credentials) outlives reconnecting. It overrides INSTAGRAM_PROXY in the connector.
  let proxy: string | undefined;
  try {
    const before = existing?.ciphertext ? await openAccountJson<{ kind?: string; proxy?: string }>(accountId, existing.ciphertext) : null;
    if (before?.kind !== "official" && typeof before?.proxy === "string") proxy = before.proxy;
  } catch {
    // Credentials that cannot be read have no proxy to keep.
  }
  if (refreshed) {
    try {
      // A session saved for another username is no use to this one.
      if ((await openAccountJson<{ username?: string }>(accountId, refreshed)).username?.toLowerCase() !== username) refreshed = null;
    } catch {
      refreshed = null;
    }
  }
  const { error } = await admin
    .from("account_credentials")
    .upsert({ account_id: accountId, ciphertext: await sealAccountJson(accountId, { kind: "private", username, password, ...(proxy ? { proxy } : {}) }), refreshed, updated_at: new Date().toISOString() }, { onConflict: "account_id" });
  if (error) throw error;
}
