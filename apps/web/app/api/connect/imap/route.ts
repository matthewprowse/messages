import { discover, domainOf, ELSEWHERE_TEXT, fromSettings, isEmail, matchPreset, readSettings, type Candidates } from "@messages/mail-servers";
import { nodeLookups } from "@messages/mail-servers/net";
import { failureText, findWorking } from "@messages/mail-servers/probe";
import { accountsReady, ensureProfile, saveAccountRow, saveCredentials } from "@/lib/server/accounts";
import { fail, foreignOrigin, limiter, noStore, signedInUser } from "@/lib/server/request";

// Connects any IMAP and SMTP mailbox from the app: mail on your own domain at Afrihost, xneelo, Domains.co.za
// or any cPanel host, and Yahoo, Fastmail, Zoho or GMX. The servers are worked out from the address (or taken
// as typed under Show Server Settings), then the sign-in is checked with both: an IMAP login, and SMTP
// authentication, which never sends. It is stored encrypted exactly as pnpm connect:imap stores it. The
// password is never logged or sent back.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Each try signs in to someone's mail server, maybe several of them, so few: 5 every 10 minutes.
const overLimit = limiter(5, 10 * 60_000);

interface Body {
  email?: string;
  password?: string;
  /** Only when they were edited under Show Server Settings. Otherwise the servers are worked out here. */
  settings?: unknown;
}

export async function POST(request: Request) {
  if (!accountsReady()) return fail(503, "Connecting email is not set up on this server yet.");
  if (foreignOrigin(request)) return fail(403, "Not allowed from this site.");
  const user = await signedInUser(request);
  if (!user) return fail(401, "Sign in first.");

  const body = (await request.json().catch(() => ({}))) as Body;
  const email = (body.email ?? "").trim().toLowerCase();
  const password = typeof body.password === "string" ? body.password : "";
  if (!isEmail(email)) return fail(400, "Enter your email address.");
  if (!password || password.length > 1024) return fail(400, "Enter your email password.");
  const typed = body.settings == null ? null : readSettings(body.settings);
  if (typed && "error" in typed) return fail(400, typed.error);
  const wait = await overLimit(user.id);
  if (wait > 0) return fail(429, "Too many tries. Wait a few minutes and try again.", { "Retry-After": String(wait) });

  let candidates: Candidates;
  if (typed) {
    candidates = fromSettings(typed, matchPreset(domainOf(email))?.preset.label);
  } else {
    const found = await discover(email, nodeLookups());
    if ("elsewhere" in found) return fail(400, ELSEWHERE_TEXT[found.elsewhere]);
    candidates = found;
  }

  const result = await findWorking(candidates, password);
  if ("failure" in result) return fail(result.failure.result === "unreachable" ? 502 : 400, failureText(result.failure, candidates.hint));
  const { settings } = result;

  try {
    await ensureProfile(user.id);
    const accountId = await saveAccountRow(user.id, "imap", candidates.label, email);
    await saveCredentials(accountId, { username: settings.username, password, aliases: [], imap: settings.imap, smtp: settings.smtp });
  } catch {
    return fail(500, "Signed in, but the account could not be saved. Try again.");
  }
  return Response.json({ label: candidates.label, settings }, { headers: noStore });
}
