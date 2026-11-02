// Connects iCloud Reminders from the app, with no Mac. The Apple ID and password are stored encrypted (kind
// "web"), and the iCloud Reminders connector (python3 -m ai icloud-reminders, in apps/ai) signs in to
// iCloud.com with them within seconds: pyicloud lives in Python and has to keep one session open through the code Apple asks for, so the
// sign-in happens there, not here. The password is dropped once the session is trusted. A session saved by an
// earlier sign-in for the same Apple ID is kept, so Apple may not ask for a code again. Nothing typed here is
// logged or sent back.

import { accountsReady } from "@/lib/server/accounts";
import { startReminders } from "@/lib/server/icloud";
import { admin, fail, foreignOrigin, limiter, noStore, readJson, signedInUser, textField } from "@/lib/server/request";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE = /^\+?[0-9 ()-]{7,20}$/; // an Apple ID can be a phone number

// Each try may become a sign-in to Apple, which watches for many of them, so few: 5 an hour.
const overLimit = limiter(5, 60 * 60_000, { name: "connect-icloud-reminders", perAddress: 20 });

export async function POST(request: Request) {
  if (!accountsReady()) return fail(503, "Connecting iCloud Reminders is not set up on this server yet.");
  if (foreignOrigin(request)) return fail(403, "Not allowed from this site.");
  const user = await signedInUser(request);
  if (!user || !admin) return fail(401, "Sign in first.");

  const body = await readJson(request);
  const rawAppleId = body && textField(body, "appleId");
  const password = body && textField(body, "password");
  if (rawAppleId === null || password === null || !body) return fail(400, "That request could not be read.");
  const appleId = rawAppleId.trim().toLowerCase();
  if (appleId.length > 254 || !(EMAIL.test(appleId) || PHONE.test(appleId))) return fail(400, "Enter your Apple ID, the email address you use for iCloud.");
  if (password.length < 6 || password.length > 256) return fail(400, "Enter your Apple ID password.");
  const wait = await overLimit(user.id, request);
  if (wait > 0) return fail(429, "Too many tries. Wait a while before connecting again.", { "Retry-After": String(wait) });

  try {
    return Response.json({ accountId: await startReminders(user.id, appleId, password) }, { headers: noStore });
  } catch {
    return fail(500, "iCloud Reminders could not be connected. Try again.");
  }
}
