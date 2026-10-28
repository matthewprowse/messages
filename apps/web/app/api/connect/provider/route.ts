// Which mail service hosts the signed-in user's own address, from its domain's MX records, so onboarding can
// put that service first: "other" for mail at any other host (Afrihost, xneelo, cPanel), connected over IMAP.
// Only the user's sign-in email is looked up, never an address sent by the browser.

import { resolveMx } from "node:dns/promises";
import { fail, foreignOrigin, limiter, noStore, signedInUser } from "@/lib/server/request";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BY_MX: [RegExp, "google" | "microsoft" | "icloud"][] = [
  [/(^|\.)(google|googlemail)\.com$/, "google"],
  [/(^|\.)(outlook\.com|office365\.us)$/, "microsoft"],
  [/(^|\.)icloud\.com$/, "icloud"],
];

// One DNS look-up per call: 30 every 10 minutes is plenty for onboarding.
const overLimit = limiter(30, 10 * 60_000, { name: "connect-provider" });

export async function POST(request: Request) {
  if (foreignOrigin(request)) return fail(403, "Not allowed from this site.");
  const user = await signedInUser(request);
  if (!user) return fail(401, "Sign in first.");
  const wait = await overLimit(user.id);
  if (wait > 0) return fail(429, "Too many tries. Wait a few minutes and try again.", { "Retry-After": String(wait) });
  const domain = user.email?.split("@")[1]?.toLowerCase();
  if (!domain) return Response.json({ provider: null }, { headers: noStore });
  try {
    const hosts = (await resolveMx(domain)).sort((a, b) => a.priority - b.priority).map((r) => r.exchange.toLowerCase().replace(/\.$/, ""));
    const provider = hosts.map((h) => BY_MX.find(([pattern]) => pattern.test(h))?.[1]).find(Boolean) ?? (hosts.length > 0 ? "other" : null);
    return Response.json({ provider }, { headers: noStore });
  } catch {
    return Response.json({ provider: null }, { headers: noStore });
  }
}
