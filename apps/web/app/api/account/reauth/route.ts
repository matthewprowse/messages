// Emails the signed-in person a one-time code, for confirming Delete My Account when they have no password or authenticator
// app to use. The code goes to the address on their own account and nowhere else; the body is ignored. Never creates a user.

import { authCall } from "@/lib/server/auth-call";
import { sendEmailCode } from "@/lib/server/reauth";
import { fail, foreignOrigin, limiter, noStore, signedInUser } from "@/lib/server/request";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// 3 codes in 15 minutes: enough to retry once, too few to use the route to mail someone.
const overLimit = limiter(3, 15 * 60_000, { name: "account-reauth", perAddress: 10 });

export async function POST(request: Request) {
  if (foreignOrigin(request)) return fail(403, "Not allowed from this site.");
  const user = await signedInUser(request);
  if (!user?.email) return fail(401, "Sign in first.");
  const wait = await overLimit(user.id, request);
  if (wait > 0) return fail(429, "Too many requests. Try again shortly.", { "Retry-After": String(wait) });
  if (!authCall || !(await sendEmailCode(authCall, user.email))) return fail(502, "Could not send a code. Try again.");
  return Response.json({ sent: true }, { headers: noStore });
}
