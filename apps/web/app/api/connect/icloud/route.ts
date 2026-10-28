// Connects iCloud+ Mail, and iCloud Calendar with the same sign-in, from the app. The app-specific password
// is checked with iCloud here, then stored encrypted exactly as pnpm connect:icloud stores it. It is never
// logged or sent back.

import { ImapFlow } from "imapflow";
import { accountsReady, ensureProfile, saveAccountRow, saveCredentials } from "@/lib/server/accounts";
import { fail, foreignOrigin, limiter, noStore, readJson, signedInUser, textField } from "@/lib/server/request";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ICLOUD_IMAP = { host: "imap.mail.me.com", port: 993, secure: true } as const;
const CALDAV = "https://caldav.icloud.com/";
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Each try is a sign-in to iCloud, so few: 5 every 10 minutes.
const overLimit = limiter(5, 10 * 60_000, { name: "connect-icloud", perAddress: 20 });

export async function POST(request: Request) {
  if (!accountsReady()) return fail(503, "Connecting iCloud is not set up on this server yet.");
  if (foreignOrigin(request)) return fail(403, "Not allowed from this site.");
  const user = await signedInUser(request);
  if (!user) return fail(401, "Sign in first.");

  const body = await readJson(request);
  const rawUsername = body && textField(body, "username");
  const rawAddress = body && textField(body, "address");
  const rawPassword = body && textField(body, "password");
  if (!body || rawUsername === null || rawAddress === null || rawPassword === null) return fail(400, "That request could not be read.");
  // The iCloud Mail sign-in, usually ending @icloud.com; the address people email you at defaults to it.
  const username = rawUsername.trim().toLowerCase();
  const address = rawAddress.trim().toLowerCase() || username;
  const password = rawPassword.replace(/\s+/g, "");
  if (!EMAIL.test(username) || !EMAIL.test(address)) return fail(400, "Enter your iCloud email address.");
  if (password.length < 16) return fail(400, "An app-specific password is 16 letters, in four groups of four.");
  const wait = await overLimit(user.id, request);
  if (wait > 0) return fail(429, "Too many tries. Wait a few minutes and try again.", { "Retry-After": String(wait) });

  const mail = await checkMail(username, password);
  if (mail === "rejected") return fail(400, "iCloud did not accept that. Check the email, and make a new app-specific password at account.apple.com.");
  if (mail === "unreachable") return fail(502, "Could not reach iCloud Mail. Try again in a moment.");
  const calendar = body.calendar !== false && (await checkCalendar(username, password));

  try {
    await ensureProfile(user.id);
    await saveCredentials(await saveAccountRow(user.id, "icloud", "iCloud+ Mail", address), { username, password, aliases: [] });
    if (calendar) await saveCredentials(await saveAccountRow(user.id, "icloud_calendar", "iCloud Calendar", username, { onePerUser: true }), { username, password });
  } catch {
    return fail(500, "Signed in, but the account could not be saved. Try again.");
  }
  return Response.json({ mail: true, calendar }, { headers: noStore });
}

async function checkMail(user: string, pass: string): Promise<"ok" | "rejected" | "unreachable"> {
  const probe = new ImapFlow({ ...ICLOUD_IMAP, auth: { user, pass }, logger: false });
  try {
    await probe.connect();
    await probe.logout();
    return "ok";
  } catch (err) {
    return (err as { authenticationFailed?: boolean }).authenticationFailed ? "rejected" : "unreachable";
  }
}

/** Whether the same sign-in opens iCloud Calendar: one PROPFIND, 207 when it does. */
async function checkCalendar(user: string, pass: string): Promise<boolean> {
  try {
    const response = await fetch(CALDAV, {
      method: "PROPFIND",
      headers: { authorization: `Basic ${Buffer.from(`${user}:${pass}`).toString("base64")}`, depth: "0", "content-type": "application/xml" },
      body: '<?xml version="1.0"?><d:propfind xmlns:d="DAV:"><d:prop><d:current-user-principal/></d:prop></d:propfind>',
      signal: AbortSignal.timeout(15_000),
    });
    return response.status === 207;
  } catch {
    return false;
  }
}
