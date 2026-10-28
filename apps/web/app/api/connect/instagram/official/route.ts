// Starts connecting a Business or Creator Instagram account from the app, like /api/connect/zoom. Who is asking
// and the state go in a short-lived encrypted cookie, which the callback reads. The access token never reaches
// the browser. Instagram's sign-in has no PKCE, so the secret stays on this server and the state proves the way back.
// With { check: true } it only says whether this server is set up for it, so the page can say so before asking.

import { randomBytes } from "node:crypto";
import { accountsReady, sealJson } from "@/lib/server/accounts";
import { authUrl, instagramReady } from "@/lib/server/instagram";
import { appOrigin, fail, foreignOrigin, limiter, noStore, readJson, signedInUser } from "@/lib/server/request";
import { INSTAGRAM_COOKIE, type InstagramSignIn } from "./shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const overLimit = limiter(10, 60_000, { name: "connect-instagram-official" });

export async function POST(request: Request) {
  if (foreignOrigin(request)) return fail(403, "Not allowed from this site.");
  const user = await signedInUser(request);
  if (!user) return fail(401, "Sign in first.");
  const ready = instagramReady() && accountsReady();
  const body = ((await readJson(request)) ?? {}) as { check?: unknown };
  if (body.check) return Response.json({ ready }, { headers: noStore });
  if (!ready) return fail(503, "Not available yet.");
  if (await overLimit(user.id) > 0) return fail(429, "Too many tries. Wait a minute and try again.");

  const state = randomBytes(16).toString("base64url");
  const signIn: InstagramSignIn = { userId: user.id, state, expires: Date.now() + 10 * 60_000 };
  const url = authUrl({ redirectUri: `${appOrigin(request)}/api/connect/instagram/official/callback`, state });

  const secure = appOrigin(request).startsWith("https:") ? "; Secure" : "";
  return Response.json({ url }, {
    headers: {
      ...noStore,
      // Lax, so it comes back on Instagram's top-level redirect to the callback.
      "Set-Cookie": `${INSTAGRAM_COOKIE}=${sealJson(signIn)}; Path=/api/connect/instagram/official; Max-Age=600; HttpOnly; SameSite=Lax${secure}`,
    },
  });
}
