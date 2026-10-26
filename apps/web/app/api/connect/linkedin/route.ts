import { accountsReady, ensureProfile, saveCredentials } from "@/lib/server/accounts";
import { admin, fail, foreignOrigin, limiter, noStore, signedInUser } from "@/lib/server/request";
import { fromPaste, fromValues } from "@/lib/linkedin-cookies";

// Connects LinkedIn with your browser's session cookies: li_at and JSESSIONID, or a whole "Copy as cURL". They
// are stored encrypted like any sign-in, and the sync worker's LinkedIn helper checks them when it connects,
// from the worker's own connection. Nothing here talks to LinkedIn, and the cookies are never logged or sent back.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const overLimit = limiter(10, 10 * 60_000);

interface Body {
  liAt?: string;
  jsessionid?: string;
  /** A "Copy as cURL (bash)" of a request to linkedin.com, or a Cookie header. */
  curl?: string;
}

export async function POST(request: Request) {
  if (!accountsReady() || !admin) return fail(503, "Connecting LinkedIn is not set up on this server yet.");
  if (foreignOrigin(request)) return fail(403, "Not allowed from this site.");
  const user = await signedInUser(request);
  if (!user) return fail(401, "Sign in first.");
  const wait = overLimit(user.id);
  if (wait > 0) return fail(429, "Too many tries. Wait a few minutes and try again.", { "Retry-After": String(wait) });

  const body = (await request.json().catch(() => ({}))) as Body;
  const session = body.curl?.trim() ? fromPaste(body.curl) : fromValues(body.liAt ?? "", body.jsessionid ?? "");
  if (!session) {
    return fail(400, body.curl?.trim()
      ? "That does not have LinkedIn's li_at and JSESSIONID cookies. Copy a request to www.linkedin.com while signed in."
      : "Paste the whole value of li_at, and of JSESSIONID, which starts with ajax:.");
  }

  try {
    await ensureProfile(user.id);
    // One LinkedIn account per person: a reconnect replaces its cookies. Its address is filled in by the
    // worker once LinkedIn says who you are.
    const { data: existing, error } = await admin.from("accounts").select("id").eq("user_id", user.id).eq("provider", "linkedin").order("created_at").limit(1);
    if (error) throw error;
    let accountId = existing[0]?.id;
    if (!accountId) {
      const { data, error: insertError } = await admin
        .from("accounts")
        .insert({ user_id: user.id, provider: "linkedin", label: "LinkedIn", address: "", status: "connecting", status_detail: "Connecting to LinkedIn." })
        .select("id")
        .single();
      if (insertError) throw insertError;
      accountId = data.id;
      await saveCredentials(accountId, session);
    } else {
      await saveCredentials(accountId, session);
      const { error: updateError } = await admin.from("accounts").update({ status: "connecting", status_detail: "Connecting to LinkedIn." }).eq("id", accountId);
      if (updateError) throw updateError;
    }
  } catch {
    return fail(500, "The cookies could not be saved. Try again.");
  }
  return Response.json({ ok: true }, { headers: noStore });
}
