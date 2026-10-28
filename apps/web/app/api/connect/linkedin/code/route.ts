import { accountsReady, openAccountJson, sealAccountJson } from "@/lib/server/accounts";
import { admin, fail, foreignOrigin, limiter, noStore, signedInUser } from "@/lib/server/request";
import { parseRelay, type SignInStep } from "../shared";

// What a LinkedIn sign-in is waiting for, and the answer. The worker's LinkedIn connector writes the step it is
// at (a six-digit code from email, SMS or an authenticator app, or an approval in the LinkedIn app) to
// account_credentials.refreshed, sealed. With no code in the body this only tells the page the step, which it
// asks for every few seconds while it waits. With a code, or tryAnotherWay, the answer is written beside the step,
// for the connector to take within seconds. Writing it changes only that column, so the connector is not
// restarted, and only if the step has not moved on since it was read.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CODE = /^[0-9]{6}$/;

// Only answers count against the limit; the page asks for the step every few seconds while it waits.
const overLimit = limiter(10, 10 * 60_000);

interface Body {
  accountId?: string;
  code?: string;
  tryAnotherWay?: boolean;
}

export async function POST(request: Request) {
  if (!accountsReady() || !admin) return fail(503, "Connecting LinkedIn is not set up on this server yet.");
  if (foreignOrigin(request)) return fail(403, "Not allowed from this site.");
  const user = await signedInUser(request);
  if (!user) return fail(401, "Sign in first.");

  const body = (await request.json().catch(() => ({}))) as Body;
  if (!body.accountId) return fail(400, "Choose the LinkedIn account.");
  const { data: account, error } = await admin.from("accounts").select("id").eq("id", body.accountId).eq("user_id", user.id).eq("provider", "linkedin").maybeSingle();
  if (error) return fail(500, "Could not check the sign-in. Try again.");
  const none = () => Response.json({ step: null }, { headers: noStore });
  if (!account) return none();
  const { data: row, error: readError } = await admin.from("account_credentials").select("refreshed").eq("account_id", account.id).maybeSingle();
  if (readError) return fail(500, "Could not check the sign-in. Try again.");
  if (!row?.refreshed) return none();
  let step: SignInStep | null = null;
  try {
    step = parseRelay(await openAccountJson<unknown>(account.id, row.refreshed)).step;
  } catch {
    return none();
  }
  if (!step) return none();
  if (body.code === undefined && !body.tryAnotherWay) return Response.json({ step }, { headers: noStore });

  const wait = await overLimit(user.id);
  if (wait > 0) return fail(429, "Too many tries. Wait a few minutes and try again.", { "Retry-After": String(wait) });

  let reply: { step: SignInStep; code?: string; tryAnotherWay?: true };
  if (body.tryAnotherWay) {
    if (step.kind !== "app" || !step.canTryAnotherWay) return fail(409, "LinkedIn has no other way to offer right now.");
    reply = { step, tryAnotherWay: true };
  } else {
    if (step.kind !== "code") return fail(409, "LinkedIn is not asking for a code right now.");
    const code = (body.code ?? "").replace(/[\s-]/g, "");
    if (!CODE.test(code)) return fail(400, "Enter the 6-digit code from LinkedIn.");
    reply = { step, code };
  }
  const { data: saved, error: saveError } = await admin
    .from("account_credentials")
    .update({ refreshed: await sealAccountJson(account.id, reply) })
    .eq("account_id", account.id)
    .eq("refreshed", row.refreshed)
    .select("account_id");
  if (saveError) return fail(500, "The answer could not be saved. Try again.");
  if (!saved?.length) return fail(409, "LinkedIn moved on to something else. Look at the page again.");
  return Response.json({ step }, { headers: noStore });
}
