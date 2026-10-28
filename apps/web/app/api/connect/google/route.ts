// Starts connecting Gmail and Google Calendar from the app. The signed-in user asks for Google's sign-in
// address; who they are, the PKCE verifier and where to come back to go in a short-lived encrypted cookie,
// which the callback reads. The refresh token never reaches the browser.

import { randomBytes } from "node:crypto";
import { accountsReady, sealJson } from "@/lib/server/accounts";
import { authUrl, googleReady, pkce } from "@/lib/server/google";
import { appOrigin, fail, foreignOrigin, limiter, noStore, readJson, signedInUser } from "@/lib/server/request";
import { GOOGLE_COOKIE, GOOGLE_RETURNS, type GoogleSignIn } from "./shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const overLimit = limiter(10, 60_000, { name: "connect-google" });

export async function POST(request: Request) {
  if (!googleReady() || !accountsReady()) return fail(503, "Connecting Google is not set up on this server yet.");
  if (foreignOrigin(request)) return fail(403, "Not allowed from this site.");
  const user = await signedInUser(request);
  if (!user) return fail(401, "Sign in first.");
  if (await overLimit(user.id) > 0) return fail(429, "Too many tries. Wait a minute and try again.");

  const body = ((await readJson(request)) ?? {}) as { back?: unknown; meet?: unknown };
  const back = GOOGLE_RETURNS.find((r) => r === body.back) ?? GOOGLE_RETURNS[0];
  const state = randomBytes(16).toString("base64url");
  const { verifier, challenge } = pkce();
  const signIn: GoogleSignIn = { userId: user.id, state, verifier, back, expires: Date.now() + 10 * 60_000 };
  const url = authUrl({ redirectUri: `${appOrigin(request)}/api/connect/google/callback`, state, challenge, hint: user.email, meet: body.meet === true });

  const secure = appOrigin(request).startsWith("https:") ? "; Secure" : "";
  return Response.json({ url }, {
    headers: {
      ...noStore,
      // Lax, so it comes back on Google's top-level redirect to the callback.
      "Set-Cookie": `${GOOGLE_COOKIE}=${sealJson(signIn)}; Path=/api/connect/google; Max-Age=600; HttpOnly; SameSite=Lax${secure}`,
    },
  });
}
