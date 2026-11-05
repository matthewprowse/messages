// Google sends the browser back here with a code. The code is traded for a refresh token, which is stored
// encrypted with the Gmail, Google Calendar and Google Tasks accounts exactly as pnpm connect:google stores it, marked as
// the web client's. Then back to the page that started it, with ?connected=google or ?connect_error=<reason>.
// With Meet and Chat granted, a Workspace account also gets its google_meet account; a personal one is sent
// back with &meet=personal (or connect_error=meet_personal when nothing else was granted), since it has neither.

import { ensureProfile, openHandoff, saveAccounts } from "@/lib/server/accounts";
import { CALENDAR_SCOPE, CHAT_MESSAGES_SCOPE, GMAIL_SCOPE, GoogleError, MEET_SCOPE, TASKS_SCOPE, exchangeCode, googleGet } from "@/lib/server/google";
import { appOrigin } from "@/lib/server/request";
import { GOOGLE_COOKIE, GOOGLE_RETURNS, type GoogleSignIn } from "../shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const origin = appOrigin(request);
  const params = new URL(request.url).searchParams;
  const signIn = await readSignIn(request);
  const back = signIn?.back ?? GOOGLE_RETURNS[0];
  const done = (query: string) =>
    new Response(null, {
      status: 303,
      headers: { Location: `${origin}${back}?${query}`, "Set-Cookie": `${GOOGLE_COOKIE}=; Path=/api/connect/google; Max-Age=0; HttpOnly; SameSite=Lax`, "Cache-Control": "no-store" },
    });

  if (params.get("error") === "access_denied") return done("connect_error=cancelled");
  if (!signIn || signIn.expires < Date.now() || params.get("state") !== signIn.state || !params.get("code")) return done("connect_error=expired");

  try {
    const tokens = await exchangeCode(params.get("code")!, `${origin}/api/connect/google/callback`, signIn.verifier);
    if (!tokens.refreshToken) return done("connect_error=no_refresh");
    const hasGmail = tokens.scopes.includes(GMAIL_SCOPE);
    const hasCalendar = tokens.scopes.includes(CALENDAR_SCOPE);
    const hasMeet = tokens.scopes.includes(MEET_SCOPE) || tokens.scopes.includes(CHAT_MESSAGES_SCOPE);
    if (!hasGmail && !hasCalendar && !hasMeet) return done("connect_error=not_granted");

    const credentials = { refreshToken: tokens.refreshToken, scopes: tokens.scopes, client: "web" as const };
    // Who signed in, and their Workspace domain: Meet transcripts and Google Chat need a Workspace account.
    const info = hasMeet
      ? await googleGet<{ email?: string; hd?: string }>("https://openidconnect.googleapis.com/v1/userinfo", tokens.accessToken).catch(() => null)
      : null;
    const address = hasGmail
      ? (await googleGet<{ emailAddress: string }>("https://gmail.googleapis.com/gmail/v1/users/me/profile", tokens.accessToken)).emailAddress.toLowerCase()
      : hasCalendar
        ? (await googleGet<{ id: string }>("https://www.googleapis.com/calendar/v3/calendars/primary", tokens.accessToken)).id.toLowerCase()
        : info?.email?.toLowerCase();
    if (!address) return done("connect_error=failed");
    const workspace = info ? !!info.hd : !/@(gmail|googlemail)\.com$/i.test(address);
    if (hasMeet && !workspace && !hasGmail && !hasCalendar) return done("connect_error=meet_personal");

    await ensureProfile(signIn.userId);
    const rows = [
      ...(hasGmail ? [{ provider: "gmail" as const, label: "Gmail", address }] : []),
      ...(hasCalendar ? [{ provider: "google_calendar" as const, label: "Google Calendar", address }] : []),
      // Google Tasks gives no address of its own, so it is connected alongside Gmail or Calendar.
      ...(tokens.scopes.includes(TASKS_SCOPE) ? [{ provider: "google_tasks" as const, label: "Google Tasks", address }] : []),
      ...(hasMeet && workspace ? [{ provider: "google_meet" as const, label: "Google Meet and Chat", address }] : []),
    ];
    const { saved, failed } = await saveAccounts(signIn.userId, rows, credentials);
    if (rows.length && !saved.length) return done("connect_error=failed");
    // Some saved and some not: the saved ones are connected, and the page is told how many were left out.
    const notSaved = failed.length ? `&not_saved=${failed.length}` : "";
    const partial = hasGmail === hasCalendar ? "" : hasGmail ? "&partial=calendar" : "&partial=gmail";
    return done(`connected=google${partial}${hasMeet && !workspace ? "&meet=personal" : ""}${notSaved}`);
  } catch (err) {
    const code = err instanceof GoogleError ? err.code : "failed";
    return done(`connect_error=${/^[a-z0-9_]{1,30}$/.test(code) ? code : "failed"}`);
  }
}

async function readSignIn(request: Request): Promise<GoogleSignIn | null> {
  const raw = request.headers.get("cookie")?.split(/;\s*/).find((c) => c.startsWith(`${GOOGLE_COOKIE}=`))?.slice(GOOGLE_COOKIE.length + 1);
  if (!raw) return null;
  try {
    const signIn = await openHandoff<GoogleSignIn>(raw, "google_connect", request);
    return GOOGLE_RETURNS.some((r) => r === signIn.back) ? signIn : null;
  } catch {
    return null;
  }
}
