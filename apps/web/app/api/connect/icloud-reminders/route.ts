import { accountsReady, ensureProfile, openAccountJson, saveAccountRow, sealAccountJson } from "@/lib/server/accounts";
import { admin, fail, foreignOrigin, limiter, noStore, signedInUser } from "@/lib/server/request";

// Connects iCloud Reminders from the app, with no Mac. The Apple ID and password are stored encrypted (kind
// "web", which tells the sync worker's Mac relay connector to leave the account alone), and the iCloud
// Reminders connector (python3 -m ai icloud-reminders, in apps/ai) signs in to iCloud.com with them within
// seconds: pyicloud lives in Python and has to keep one session open through the code Apple asks for, so the
// sign-in happens there, not here. The password is dropped once the session is trusted. A session saved by an
// earlier sign-in for the same Apple ID is kept, so Apple may not ask for a code again. Nothing typed here is
// logged or sent back.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE = /^\+?[0-9 ()-]{7,20}$/; // an Apple ID can be a phone number

// Each try may become a sign-in to Apple, which watches for many of them, so few: 5 an hour.
const overLimit = limiter(5, 60 * 60_000);

interface Body {
  appleId?: string;
  password?: string;
}

export async function POST(request: Request) {
  if (!accountsReady()) return fail(503, "Connecting iCloud Reminders is not set up on this server yet.");
  if (foreignOrigin(request)) return fail(403, "Not allowed from this site.");
  const user = await signedInUser(request);
  if (!user || !admin) return fail(401, "Sign in first.");

  const body = (await request.json().catch(() => ({}))) as Body;
  const appleId = (body.appleId ?? "").trim().toLowerCase();
  const password = body.password ?? "";
  if (appleId.length > 254 || !(EMAIL.test(appleId) || PHONE.test(appleId))) return fail(400, "Enter your Apple ID, the email address you use for iCloud.");
  if (password.length < 6 || password.length > 256) return fail(400, "Enter your Apple ID password.");
  const wait = await overLimit(user.id);
  if (wait > 0) return fail(429, "Too many tries. Wait a while before connecting again.", { "Retry-After": String(wait) });

  try {
    await ensureProfile(user.id);
    // One Reminders account per person: signing in with another Apple ID takes over the account they have.
    const accountId = await saveAccountRow(user.id, "icloud_reminders", "iCloud Reminders", appleId, { onePerUser: true });
    // A sign-in step left over from an earlier try is cleared, so the app never shows a stale one.
    await admin.from("instagram_sign_ins").delete().eq("account_id", accountId);
    const { error: statusError } = await admin.from("accounts").update({ status_detail: "Signing in to iCloud." }).eq("id", accountId);
    if (statusError) throw statusError;
    await saveSignIn(accountId, appleId, password);
    return Response.json({ accountId }, { headers: noStore });
  } catch {
    return fail(500, "iCloud Reminders could not be connected. Try again.");
  }
}

/** The sign-in, keeping the connector's saved session (refreshed) when it is for the same Apple ID. */
async function saveSignIn(accountId: string, appleId: string, password: string) {
  if (!admin) throw new Error("Supabase is not set up.");
  const { data: existing } = await admin.from("account_credentials").select("refreshed").eq("account_id", accountId).maybeSingle();
  let refreshed = existing?.refreshed ?? null;
  if (refreshed) {
    try {
      // A session saved for another Apple ID is no use to this one.
      if ((await openAccountJson<{ appleId?: string }>(accountId, refreshed)).appleId?.toLowerCase() !== appleId) refreshed = null;
    } catch {
      refreshed = null;
    }
  }
  const { error } = await admin
    .from("account_credentials")
    .upsert({ account_id: accountId, ciphertext: await sealAccountJson(accountId, { kind: "web", appleId, password }), refreshed, updated_at: new Date().toISOString() }, { onConflict: "account_id" });
  if (error) throw error;
}
