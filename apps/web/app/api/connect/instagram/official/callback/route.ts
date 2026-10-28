// Instagram sends the browser back here with a code. The code is traded for a token that lasts 60 days, which is
// stored encrypted with the account as credentials of kind "official" (the Instagram connector in apps/ai reads
// them and renews the token before it ends). Then back to Settings, with ?connected=instagram or ?connect_error=<reason>.

import { ensureProfile, openJson, saveAccountRow, saveCredentials } from "@/lib/server/accounts";
import { BASIC_SCOPE, InstagramError, MESSAGES_SCOPE, exchangeCode, instagramAccount, longLivedToken } from "@/lib/server/instagram";
import { admin, appOrigin } from "@/lib/server/request";
import { INSTAGRAM_COOKIE, INSTAGRAM_OFFICIAL_LABEL, INSTAGRAM_RETURN, type InstagramSignIn } from "../shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const origin = appOrigin(request);
  const params = new URL(request.url).searchParams;
  const signIn = readSignIn(request);
  const done = (query: string) =>
    new Response(null, {
      status: 303,
      headers: { Location: `${origin}${INSTAGRAM_RETURN}?${query}`, "Set-Cookie": `${INSTAGRAM_COOKIE}=; Path=/api/connect/instagram/official; Max-Age=0; HttpOnly; SameSite=Lax`, "Cache-Control": "no-store" },
    });

  if (params.get("error") === "access_denied") return done("connect_error=cancelled");
  if (!signIn || signIn.expires < Date.now() || params.get("state") !== signIn.state || !params.get("code")) return done("connect_error=expired");

  try {
    const short = await exchangeCode(params.get("code")!, `${origin}/api/connect/instagram/official/callback`);
    if (![BASIC_SCOPE, MESSAGES_SCOPE].every((s) => short.scopes.includes(s))) return done("connect_error=not_granted");
    const long = await longLivedToken(short.accessToken);
    const me = await instagramAccount(long.accessToken);
    if (me.type !== "BUSINESS" && me.type !== "MEDIA_CREATOR") return done("connect_error=personal");

    await ensureProfile(signIn.userId);
    const accountId = await saveAccountRow(signIn.userId, "instagram", INSTAGRAM_OFFICIAL_LABEL, me.username);
    await saveCredentials(accountId, { kind: "official", accessToken: long.accessToken, expiresAt: long.expiresAt, userId: me.userId, username: me.username, scopes: short.scopes });
    // A personal sign-in step left over from an earlier try is cleared, so the app never shows a stale one.
    await admin?.from("instagram_sign_ins").delete().eq("account_id", accountId);
    return done("connected=instagram");
  } catch (err) {
    const code = err instanceof InstagramError ? err.code : "failed";
    return done(`connect_error=${/^[a-z0-9_]{1,30}$/.test(code) ? code : "failed"}`);
  }
}

function readSignIn(request: Request): InstagramSignIn | null {
  const raw = request.headers.get("cookie")?.split(/;\s*/).find((c) => c.startsWith(`${INSTAGRAM_COOKIE}=`))?.slice(INSTAGRAM_COOKIE.length + 1);
  if (!raw) return null;
  try {
    return openJson<InstagramSignIn>(raw);
  } catch {
    return null;
  }
}
