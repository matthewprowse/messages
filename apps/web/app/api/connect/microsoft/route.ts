// Starts connecting Outlook, Outlook Calendar, Microsoft To Do and (when ticked) Teams from the app. The signed-in
// user asks for Microsoft's sign-in address; who they are, the PKCE verifier and where to come back to go in a
// short-lived encrypted cookie, which the callback reads. The refresh token never reaches the browser.

import { randomBytes } from "node:crypto";
import { accountsReady, sealJson } from "@/lib/server/accounts";
import { authUrl, microsoftReady, pkce } from "@/lib/server/microsoft";
import { appOrigin, fail, foreignOrigin, limiter, noStore, readJson, signedInUser } from "@/lib/server/request";
import { MICROSOFT_COOKIE, MICROSOFT_RETURNS, type MicrosoftSignIn } from "./shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const overLimit = limiter(10, 60_000, { name: "connect-microsoft" });

export async function POST(request: Request) {
  if (!microsoftReady() || !accountsReady()) return fail(503, "Connecting Microsoft is not set up on this server yet.");
  if (foreignOrigin(request)) return fail(403, "Not allowed from this site.");
  const user = await signedInUser(request);
  if (!user) return fail(401, "Sign in first.");
  if (await overLimit(user.id) > 0) return fail(429, "Too many tries. Wait a minute and try again.");

  const body = ((await readJson(request)) ?? {}) as { back?: unknown; teams?: unknown; calendarWrite?: unknown };
  const back = MICROSOFT_RETURNS.find((r) => r === body.back) ?? MICROSOFT_RETURNS[0];
  const teams = body.teams === true;
  const calendarWrite = body.calendarWrite === true;
  const state = randomBytes(16).toString("base64url");
  const { verifier, challenge } = pkce();
  const signIn: MicrosoftSignIn = { userId: user.id, state, verifier, back, teams, calendarWrite, expires: Date.now() + 10 * 60_000 };
  const url = authUrl({ redirectUri: `${appOrigin(request)}/api/connect/microsoft/callback`, state, challenge, teams, calendarWrite });

  const secure = appOrigin(request).startsWith("https:") ? "; Secure" : "";
  return Response.json({ url }, {
    headers: {
      ...noStore,
      // Lax, so it comes back on Microsoft's top-level redirect to the callback.
      "Set-Cookie": `${MICROSOFT_COOKIE}=${sealJson(signIn)}; Path=/api/connect/microsoft; Max-Age=600; HttpOnly; SameSite=Lax${secure}`,
    },
  });
}
