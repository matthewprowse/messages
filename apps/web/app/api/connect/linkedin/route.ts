// Connects LinkedIn from the app with an email and password. They are stored encrypted, like any sign-in, with
// when they were typed, and the sync worker's LinkedIn connector signs in with them within seconds from the
// worker's own connection: the sign-in has to keep one helper open through any code or approval LinkedIn asks
// for, so it happens there, not here (see code/route.ts for the page's side of that). The password is dropped
// the moment the sign-in ends, whichever way, and only the session it made is kept. Pasted browser cookies
// (li_at and JSESSIONID, or a whole "Copy as cURL") are still taken as a fallback, as a session already.
// An optional proxy is kept with the credentials and used for both. Nothing here talks to LinkedIn, and
// nothing typed is logged or sent back.

import { accountsReady, ensureProfile, openAccountJson, saveCredentials } from "@/lib/server/accounts";
import { admin, fail, foreignOrigin, limiter, noStore, readJson, signedInUser, textField } from "@/lib/server/request";
import { cleanProxy, fromPaste, fromValues } from "@/lib/linkedin-cookies";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Each password try may become a sign-in to LinkedIn, which watches for many of them, so few: 5 an hour.
const overSignInLimit = limiter(5, 60 * 60_000, { name: "connect-linkedin-signin", perAddress: 20 });
const overCookiesLimit = limiter(10, 10 * 60_000, { name: "connect-linkedin-cookies" });

export async function POST(request: Request) {
  if (!accountsReady() || !admin) return fail(503, "Connecting LinkedIn is not set up on this server yet.");
  if (foreignOrigin(request)) return fail(403, "Not allowed from this site.");
  const user = await signedInUser(request);
  if (!user) return fail(401, "Sign in first.");

  const raw = await readJson(request);
  // email, password, liAt, jsessionid, curl and proxy are all strings when present. A proxy left out keeps the
  // one the account has; "" clears it. curl is a "Copy as cURL (bash)" of a request to linkedin.com, or a Cookie header.
  const fields = raw && {
    email: textField(raw, "email"),
    password: textField(raw, "password"),
    liAt: textField(raw, "liAt"),
    jsessionid: textField(raw, "jsessionid"),
    curl: textField(raw, "curl"),
    proxy: textField(raw, "proxy"),
  };
  if (!raw || !fields || Object.values(fields).some((v) => v === null)) return fail(400, "That request could not be read.");
  const body = { ...fields, proxy: raw.proxy === undefined ? undefined : fields.proxy } as { email: string; password: string; liAt: string; jsessionid: string; curl: string; proxy: string | undefined };
  const withPassword = raw.password !== undefined || raw.email !== undefined;
  const email = body.email.trim();
  const password = body.password;
  let session: ReturnType<typeof fromPaste> = null;
  if (withPassword) {
    if (email.length < 3 || email.length > 254 || /\s/.test(email)) return fail(400, "Enter the email you use for LinkedIn.");
    if (password.length < 6 || password.length > 400) return fail(400, "Enter your LinkedIn password.");
  } else {
    session = body.curl.trim() ? fromPaste(body.curl) : fromValues(body.liAt, body.jsessionid);
    if (!session) {
      return fail(400, body.curl.trim()
        ? "That does not have LinkedIn's li_at and JSESSIONID cookies. Copy a request to www.linkedin.com while signed in."
        : "Sign in with your email and password, or paste the cookies from a browser where you are signed in.");
    }
  }
  let proxy: string | undefined;
  if (typeof body.proxy === "string" && body.proxy.trim()) {
    proxy = cleanProxy(body.proxy) ?? undefined;
    if (!proxy) return fail(400, "That proxy address does not look right. It starts with http://, https:// or socks5://.");
  }
  const wait = await (withPassword ? overSignInLimit : overCookiesLimit)(user.id, request);
  if (wait > 0) return fail(429, "Too many tries. Wait a while before connecting again.", { "Retry-After": String(wait) });

  try {
    await ensureProfile(user.id);
    // One LinkedIn account per person: a reconnect replaces its sign-in. Its address is filled in by the
    // worker once LinkedIn says who you are.
    const { data: existing, error } = await admin.from("accounts").select("id").eq("user_id", user.id).eq("provider", "linkedin").order("created_at").limit(1);
    if (error) throw error;
    let accountId = existing[0]?.id;
    const detail = withPassword ? "Signing in to LinkedIn." : "Connecting to LinkedIn.";
    if (!accountId) {
      const { data, error: insertError } = await admin
        .from("accounts")
        .insert({ user_id: user.id, provider: "linkedin", label: "LinkedIn", address: "", status: "connecting", status_detail: detail })
        .select("id")
        .single();
      if (insertError) throw insertError;
      accountId = data.id;
    }
    // A proxy not mentioned stays as it was, so signing in again does not lose it.
    if (typeof body.proxy !== "string") proxy = await savedProxy(accountId);
    const withProxy = proxy ? { proxy } : {};
    await saveCredentials(accountId, withPassword ? { email, password, requestedAt: Date.now(), ...withProxy } : { ...session, ...withProxy });
    const { error: updateError } = await admin.from("accounts").update({ status: "connecting", status_detail: detail }).eq("id", accountId);
    if (updateError) throw updateError;
    return Response.json({ accountId }, { headers: noStore });
  } catch {
    return fail(500, "LinkedIn could not be connected. Try again.");
  }
}

/** The proxy an account already has, from its saved sign-in or session. */
async function savedProxy(accountId: string): Promise<string | undefined> {
  if (!admin) return undefined;
  const { data } = await admin.from("account_credentials").select("ciphertext").eq("account_id", accountId).maybeSingle();
  if (!data) return undefined;
  try {
    return (await openAccountJson<{ proxy?: string }>(accountId, data.ciphertext)).proxy || undefined;
  } catch {
    return undefined;
  }
}
