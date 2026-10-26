import { ensureProfile, openJson, saveAccountRow, saveCredentials } from "@/lib/server/accounts";
import { CHAT_SCOPES, RECORDINGS_SCOPE, ZoomError, exchangeCode, zoomUser } from "@/lib/server/zoom";
import { appOrigin } from "@/lib/server/request";
import { ZOOM_COOKIE, ZOOM_RETURN, type ZoomSignIn } from "../shared";

// Zoom sends the browser back here with a code. The code is traded for a refresh token, which is stored
// encrypted with the Zoom account in the shape the worker reads (apps/worker/src/zoom/oauth.ts,
// ZoomCredentials). Then back to Settings, with ?connected=zoom or ?connect_error=<reason>.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const origin = appOrigin(request);
  const params = new URL(request.url).searchParams;
  const signIn = readSignIn(request);
  const done = (query: string) =>
    new Response(null, {
      status: 303,
      headers: { Location: `${origin}${ZOOM_RETURN}?${query}`, "Set-Cookie": `${ZOOM_COOKIE}=; Path=/api/connect/zoom; Max-Age=0; HttpOnly; SameSite=Lax`, "Cache-Control": "no-store" },
    });

  if (params.get("error") === "access_denied") return done("connect_error=cancelled");
  if (!signIn || signIn.expires < Date.now() || params.get("state") !== signIn.state || !params.get("code")) return done("connect_error=expired");

  try {
    const tokens = await exchangeCode(params.get("code")!, `${origin}/api/connect/zoom/callback`, signIn.verifier);
    if (!tokens.refreshToken) return done("connect_error=no_refresh");
    const meetings = tokens.scopes.includes(RECORDINGS_SCOPE);
    const chat = CHAT_SCOPES.every((s) => tokens.scopes.includes(s));
    if (!meetings && !chat) return done("connect_error=not_granted");

    const me = await zoomUser(tokens.apiUrl, tokens.accessToken);
    await ensureProfile(signIn.userId);
    const accountId = await saveAccountRow(signIn.userId, "zoom", "Zoom", me.email);
    await saveCredentials(accountId, { refreshToken: tokens.refreshToken, scopes: tokens.scopes, userId: me.id, email: me.email, apiUrl: tokens.apiUrl });
    return done(`connected=zoom${meetings && chat ? "" : meetings ? "&partial=chat" : "&partial=meetings"}`);
  } catch (err) {
    const code = err instanceof ZoomError ? err.code : "failed";
    return done(`connect_error=${/^[a-z0-9_]{1,30}$/.test(code) ? code : "failed"}`);
  }
}

function readSignIn(request: Request): ZoomSignIn | null {
  const raw = request.headers.get("cookie")?.split(/;\s*/).find((c) => c.startsWith(`${ZOOM_COOKIE}=`))?.slice(ZOOM_COOKIE.length + 1);
  if (!raw) return null;
  try {
    return openJson<ZoomSignIn>(raw);
  } catch {
    return null;
  }
}
