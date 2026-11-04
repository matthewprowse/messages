// The server settings for an address, to fill in Show Server Settings before connecting: a preset, an
// autoconfig file or a guess from the domain (@messages/mail-servers). Nothing is signed in to here.

import { discover, firstSettings, isEmail } from "@messages/mail-servers";
import { nodeLookups } from "@messages/mail-servers/net";
import { fail, foreignOrigin, limiter, noStore, readJson, signedInUser, textField } from "@/lib/server/request";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Each look-up makes a few DNS and HTTPS requests: 30 every 10 minutes is plenty for typing an address.
const overLimit = limiter(30, 10 * 60_000, { name: "connect-imap-settings" });
// A day's cap per person and per address on top, so the look-ups cannot be scripted as a free DNS and autoconfig relay.
const overDailyLimit = limiter(200, 24 * 60 * 60_000, { name: "connect-imap-settings-day", perAddress: 500 });

export async function POST(request: Request) {
  if (foreignOrigin(request)) return fail(403, "Not allowed from this site.");
  const user = await signedInUser(request);
  if (!user) return fail(401, "Sign in first.");
  const body = await readJson(request);
  const rawEmail = body && textField(body, "email");
  if (rawEmail === null || !body) return fail(400, "Enter your email address.");
  const email = rawEmail.trim().toLowerCase();
  if (!isEmail(email)) return fail(400, "Enter your email address.");
  const wait = await overLimit(user.id);
  if (wait > 0) return fail(429, "Too many look-ups. Wait a few minutes, or type the settings in.", { "Retry-After": String(wait) });
  const waitDay = await overDailyLimit(user.id, request);
  if (waitDay > 0) return fail(429, "Too many look-ups today. Type the settings in, or try again tomorrow.", { "Retry-After": String(waitDay) });

  const found = await discover(email, nodeLookups());
  if ("elsewhere" in found) return Response.json({ elsewhere: found.elsewhere }, { headers: noStore });
  return Response.json({ settings: firstSettings(found), source: found.source, label: found.label, hint: found.hint ?? null }, { headers: noStore });
}
