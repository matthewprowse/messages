import { randomBytes } from "node:crypto";
import { accountsReady, sealJson } from "@/lib/server/accounts";
import { pkce } from "@/lib/server/google";
import { authUrl, zoomReady } from "@/lib/server/zoom";
import { appOrigin, fail, foreignOrigin, limiter, noStore, signedInUser } from "@/lib/server/request";
import { ZOOM_COOKIE, type ZoomSignIn } from "./shared";

// Starts connecting Zoom from the app, like /api/connect/google. Who is asking and the PKCE verifier go in a
// short-lived encrypted cookie, which the callback reads. The refresh token never reaches the browser.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const overLimit = limiter(10, 60_000);

export async function POST(request: Request) {
  if (!zoomReady() || !accountsReady()) return fail(503, "Connecting Zoom is not set up on this server yet.");
  if (foreignOrigin(request)) return fail(403, "Not allowed from this site.");
  const user = await signedInUser(request);
  if (!user) return fail(401, "Sign in first.");
  if (await overLimit(user.id) > 0) return fail(429, "Too many tries. Wait a minute and try again.");

  const state = randomBytes(16).toString("base64url");
  const { verifier, challenge } = pkce();
  const signIn: ZoomSignIn = { userId: user.id, state, verifier, expires: Date.now() + 10 * 60_000 };
  const url = authUrl({ redirectUri: `${appOrigin(request)}/api/connect/zoom/callback`, state, challenge });

  const secure = appOrigin(request).startsWith("https:") ? "; Secure" : "";
  return Response.json({ url }, {
    headers: {
      ...noStore,
      // Lax, so it comes back on Zoom's top-level redirect to the callback.
      "Set-Cookie": `${ZOOM_COOKIE}=${sealJson(signIn)}; Path=/api/connect/zoom; Max-Age=600; HttpOnly; SameSite=Lax${secure}`,
    },
  });
}
