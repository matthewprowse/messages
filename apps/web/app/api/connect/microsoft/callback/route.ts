// Microsoft sends the browser back here with a code. The code is traded for a refresh token, which is stored
// encrypted with the Outlook, Outlook Calendar, Microsoft To Do and Teams accounts exactly as pnpm connect:microsoft
// stores it. Then back to the page that started it, with ?connected=microsoft or ?connect_error=<reason>. When an
// IT admin has to approve the app first, the page gets connect_error=admin_approval and flags for what was asked
// (admin_teams, admin_calendar_write), never the link itself: it asks /api/connect/microsoft/admin-link for that, so a
// crafted address cannot put another app's consent page in front of an IT admin.

import { ensureProfile, openHandoff, saveAccounts } from "@/lib/server/accounts";
import { CALENDAR_WRITE_SCOPE, CHAT_SCOPE, MicrosoftError, accountsFor, exchangeCode, needsAdminApproval, signedInAddress, SEND_SCOPE, MAIL_SCOPE, type MicrosoftCredentials } from "@/lib/server/microsoft";
import { appOrigin } from "@/lib/server/request";
import { MICROSOFT_COOKIE, MICROSOFT_RETURNS, readCookie, signInProblem, type MicrosoftSignIn } from "../shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const origin = appOrigin(request);
  const params = new URL(request.url).searchParams;
  const signIn = await readSignIn(request);
  const back = signIn?.back ?? MICROSOFT_RETURNS[0];
  const done = (query: string) =>
    new Response(null, {
      status: 303,
      headers: { Location: `${origin}${back}?${query}`, "Set-Cookie": `${MICROSOFT_COOKIE}=; Path=/api/connect/microsoft; Max-Age=0; HttpOnly; SameSite=Lax`, "Cache-Control": "no-store" },
    });
  const teams = signIn?.teams === true;
  const calendarWrite = signIn?.calendarWrite === true;
  const needsAdmin = () => done(["connect_error=admin_approval", teams ? "admin_teams=1" : "", calendarWrite ? "admin_calendar_write=1" : ""].filter(Boolean).join("&"));

  const error = params.get("error");
  if (signIn && signIn.expires >= Date.now() && params.get("state") === signIn.state) {
    if (needsAdminApproval(error, params.get("error_description"))) return needsAdmin();
    if (error === "invalid_scope" && teams) return done("connect_error=personal_teams");
  }
  if (error === "access_denied") return done("connect_error=cancelled");
  if (signInProblem(signIn, params, Date.now())) return done("connect_error=expired");

  try {
    const tokens = await exchangeCode(params.get("code")!, `${origin}/api/connect/microsoft/callback`, signIn!.verifier, teams, calendarWrite);
    if (!tokens.refreshToken) return done("connect_error=no_refresh");
    const rows = accountsFor(tokens.scopes);
    if (!rows.length) return done("connect_error=not_granted");
    const address = await signedInAddress(tokens.accessToken);
    if (!address) return done("connect_error=failed");

    const credentials: MicrosoftCredentials = { refreshToken: tokens.refreshToken, scopes: tokens.scopes };
    await ensureProfile(signIn!.userId);
    const { saved, failed } = await saveAccounts(signIn!.userId, rows.map((row) => ({ provider: row.provider, label: row.label, address })), credentials);
    if (!saved.length) return done("connect_error=failed");

    const notes = [
      tokens.scopes.includes(MAIL_SCOPE) ? "" : "mail=missing",
      tokens.scopes.includes(MAIL_SCOPE) && !tokens.scopes.includes(SEND_SCOPE) ? "send=missing" : "",
      teams && !tokens.scopes.includes(CHAT_SCOPE) ? "teams=missing" : "",
      calendarWrite && !tokens.scopes.includes(CALENDAR_WRITE_SCOPE) ? "calendar_write=missing" : "",
      // Some saved and some not: the saved ones are connected, and the page is told how many were left out.
      failed.length ? `not_saved=${failed.length}` : "",
    ].filter(Boolean);
    return done(["connected=microsoft", ...notes].join("&"));
  } catch (err) {
    if (err instanceof MicrosoftError && err.code === "consent_required") return needsAdmin();
    if (err instanceof MicrosoftError && err.code === "invalid_scope" && teams) return done("connect_error=personal_teams");
    const code = err instanceof MicrosoftError ? err.code.toLowerCase() : "failed";
    return done(`connect_error=${/^[a-z0-9_]{1,30}$/.test(code) ? code : "failed"}`);
  }
}

async function readSignIn(request: Request): Promise<MicrosoftSignIn | null> {
  const raw = readCookie(request.headers.get("cookie"), MICROSOFT_COOKIE);
  if (!raw) return null;
  try {
    const signIn = await openHandoff<MicrosoftSignIn>(raw, "microsoft_connect");
    return MICROSOFT_RETURNS.some((r) => r === signIn.back) ? signIn : null;
  } catch {
    return null;
  }
}
