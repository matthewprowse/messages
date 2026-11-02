// Connects iCloud with one Apple ID sign-in: the person ticks Mail, Calendar and Reminders, and nobody has to make an
// app-specific password by hand. For Mail or Calendar the sign-in is queued in icloud_setups (sealed), and the iCloud
// connector in the AI worker signs in to the account page, asks for the code through ./step, and makes the password;
// ./step then saves the accounts. Reminders alone needs no password made, so it starts at once. Nothing typed here is
// logged or sent back.

import { accountsReady, sealJson } from "@/lib/server/accounts";
import { startReminders } from "@/lib/server/icloud";
import { admin, fail, foreignOrigin, limiter, noStore, readJson, signedInUser, textField } from "@/lib/server/request";
import { chosenServices, mailLogin } from "@/lib/icloud-signin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE = /^\+?[0-9 ()-]{7,20}$/; // an Apple ID can be a phone number

// Each try is a sign-in to Apple, which watches for many of them, so few: 5 an hour.
const overLimit = limiter(5, 60 * 60_000, { name: "connect-icloud-signin", perAddress: 20 });

export async function POST(request: Request) {
  if (!accountsReady()) return fail(503, "Connecting iCloud is not set up on this server yet.");
  if (foreignOrigin(request)) return fail(403, "Not allowed from this site.");
  const user = await signedInUser(request);
  if (!user || !admin) return fail(401, "Sign in first.");

  const body = await readJson(request);
  const rawAppleId = body && textField(body, "appleId");
  const password = body && textField(body, "password");
  const mailAddress = (body && textField(body, "mailAddress")) ?? "";
  const rawAddress = (body && textField(body, "address")) ?? "";
  if (!body || rawAppleId === null || password === null) return fail(400, "That request could not be read.");
  const appleId = rawAppleId.trim().toLowerCase();
  if (appleId.length > 254 || !(EMAIL.test(appleId) || PHONE.test(appleId))) return fail(400, "Enter your Apple ID, the email address you use for iCloud.");
  if (password.length < 6 || password.length > 256) return fail(400, "Enter your Apple ID password.");
  const services = chosenServices({ mail: body.mail, calendar: body.calendar, reminders: body.reminders });
  if (!services) return fail(400, "Choose at least one of Mail, Calendar and Reminders.");
  const wantsPassword = services.includes("mail") || services.includes("calendar");
  const mailUser = mailLogin(appleId, mailAddress);
  if (wantsPassword && !mailUser) return fail(400, "Enter your iCloud Mail address, the one ending @icloud.com.");
  const address = rawAddress.trim().toLowerCase() || mailUser || "";
  if (address && !EMAIL.test(address)) return fail(400, "Enter the address people email you at.");
  const wait = await overLimit(user.id, request);
  if (wait > 0) return fail(429, "Too many tries. Wait a while before connecting again.", { "Retry-After": String(wait) });

  try {
    if (!wantsPassword) return Response.json({ remindersAccountId: await startReminders(user.id, appleId, password) }, { headers: noStore });
    // One sign-in at a time per person: an older one still waiting is replaced.
    await admin.from("icloud_setups").delete().eq("user_id", user.id).in("status", ["queued", "signing_in", "failed"]);
    const { data, error } = await admin
      .from("icloud_setups")
      .insert({ user_id: user.id, services, sign_in: sealJson({ appleId, password, mailUser, address }), detail: "Signing in to your Apple Account." })
      .select("id")
      .single();
    if (error) throw error;
    return Response.json({ setupId: data.id }, { headers: noStore });
  } catch {
    return fail(500, "iCloud could not be connected. Try again.");
  }
}
