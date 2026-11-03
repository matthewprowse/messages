// Saves a Request Access form from the marketing site into the waitlist, which Admin reads. Anyone may call it, so it
// is limited per address and a filled honeypot field is answered like a success without saving anything. Asking twice
// with one email keeps the first request and its status, and answers the same way, so the form never reveals who is
// already on the list.

import { checkRequest } from "@/lib/waitlist";
import { admin, clientAddress, fail, foreignOrigin, limiter, noStore } from "@/lib/server/request";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// 5 requests a minute per address: a person asks once, perhaps after fixing a typo.
const overLimit = limiter(5, 60_000, { name: "waitlist", fallbackToMemory: true });

export async function POST(request: Request) {
  if (!admin) return fail(503, "Requests are not set up.");
  if (foreignOrigin(request)) return fail(403, "Not allowed from this site.");
  const wait = await overLimit(clientAddress(request));
  if (wait > 0) return fail(429, "Too many requests. Try again shortly.", { "Retry-After": String(wait) });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return fail(400, "Enter a valid email address.");
  }
  if (body && typeof body === "object" && typeof (body as { website?: unknown }).website === "string" && (body as { website: string }).website.trim()) {
    return Response.json({ ok: true }, { headers: noStore });
  }
  const checked = checkRequest(body);
  if (!checked.ok) return fail(400, checked.error);

  const { kind, email, company, teamSize } = checked.value;
  const { error } = await admin
    .from("waitlist")
    .upsert({ kind, email, company: company ?? null, team_size: teamSize ?? null }, { onConflict: "email", ignoreDuplicates: true });
  if (error) return fail(500, "Could not save your request. Try again.");
  return Response.json({ ok: true }, { headers: noStore });
}
