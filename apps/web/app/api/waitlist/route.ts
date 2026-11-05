// Saves a Request Access form from the marketing site into the waitlist, which Admin reads. Anyone may call it, so it
// is limited per address and a filled honeypot field is answered like a success without saving anything. Asking twice
// with one email answers the same way, so the form never reveals who is already on the list. A decided request keeps its
// status and details; a pending one takes a later team request's company and size, so someone who put another person's
// email down first cannot lock out that person's real team request (the email is not verified, so the latest one wins).

import { checkRequest } from "@/lib/waitlist";
import { admin, fail, foreignOrigin, limitedAddress, limiter, noStore, readCapped } from "@/lib/server/request";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// 5 requests a minute per address: a person asks once, perhaps after fixing a typo.
const overLimit = limiter(5, 60_000, { name: "waitlist", fallbackToMemory: true });

export async function POST(request: Request) {
  if (!admin) return fail(503, "Requests are not set up.");
  if (foreignOrigin(request)) return fail(403, "Not allowed from this site.");
  const address = limitedAddress(request);
  if (!address) return fail(403, "Not allowed from here.");
  const wait = await overLimit(address);
  if (wait > 0) return fail(429, "Too many requests. Try again shortly.", { "Retry-After": String(wait) });

  let body: unknown;
  try {
    const text = await readCapped(request, 16 * 1024); // bytes: a request is a name, an email and a few words
    if (text === null) return fail(413, "That is too long.");
    body = JSON.parse(text);
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
  // An individual request never replaces a pending team one: it carries less, so it would only throw details away.
  if (kind === "team") {
    const updated = await admin.from("waitlist").update({ kind, company: company ?? null, team_size: teamSize ?? null }).eq("email", email).eq("status", "pending");
    if (updated.error) return fail(500, "Could not save your request. Try again.");
  }
  return Response.json({ ok: true }, { headers: noStore });
}
