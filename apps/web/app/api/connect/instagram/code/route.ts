// The code Instagram sent while signing in (to your email or phone, or from your authenticator app). The
// Instagram connector writes which code it is waiting for to public.instagram_sign_ins; this tells the app
// (with no code in the body) and hands the code back, encrypted, for the connector to take within seconds.

import { accountsReady, sealRowJson } from "@/lib/server/accounts";
import { admin, fail, foreignOrigin, limiter, noStore, readJson, signedInUser, textField } from "@/lib/server/request";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CODE = /^[0-9]{6,8}$/;

const overLimit = limiter(10, 10 * 60_000, { name: "connect-instagram-code" });

type InstagramStep = { step: "code" | "two_factor"; method: "email" | "sms" | "app" | null; attempts: number } | null;

export async function POST(request: Request) {
  if (!accountsReady()) return fail(503, "Connecting Instagram is not set up on this server yet.");
  if (foreignOrigin(request)) return fail(403, "Not allowed from this site.");
  const user = await signedInUser(request);
  if (!user || !admin) return fail(401, "Sign in first.");

  const body = await readJson(request);
  const accountId = body && textField(body, "accountId");
  if (!body || accountId === null || (body.code !== undefined && typeof body.code !== "string")) return fail(400, "That request could not be read.");
  if (!accountId) return fail(400, "Choose the Instagram account.");
  const { data: row, error } = await admin
    .from("instagram_sign_ins")
    .select("account_id, user_id, step, method, attempts")
    .eq("account_id", accountId)
    .maybeSingle();
  if (error) return fail(500, "Could not check the sign-in. Try again.");
  if (!row || row.user_id !== user.id) return Response.json({ step: null } satisfies { step: InstagramStep }, { headers: noStore });
  const step = { step: row.step, method: row.method, attempts: row.attempts } as NonNullable<InstagramStep>;
  if (typeof body.code !== "string") return Response.json({ step }, { headers: noStore });

  // Only codes count against the limit; the app asks for the step every few seconds while it waits.
  const wait = await overLimit(user.id);
  if (wait > 0) return fail(429, "Too many tries. Wait a few minutes and try again.", { "Retry-After": String(wait) });

  const code = body.code.replace(/[\s-]/g, "");
  if (!CODE.test(code)) return fail(400, "Enter the code from Instagram, six or eight digits.");
  // Sealed under the person's own key and bound to this row's code (lib/server/handoff.ts); the connector opens it.
  let sealed: string;
  try {
    sealed = await sealRowJson(user.id, { table: "instagram_sign_ins", column: "code" }, row.account_id, code);
  } catch {
    return fail(500, "That could not be saved. Try again.");
  }
  // Only if the step is still the one the person saw, so a code never lands on a newer prompt.
  const { data: saved, error: saveError } = await admin
    .from("instagram_sign_ins")
    .update({ code: sealed })
    .eq("account_id", row.account_id)
    .eq("user_id", user.id)
    .eq("step", row.step)
    .eq("attempts", row.attempts)
    .select("account_id");
  if (saveError) return fail(500, "The code could not be saved. Try again.");
  if (!saved?.length) return fail(409, "Instagram moved on to something else. Look at the page again.");
  return Response.json({ step }, { headers: noStore });
}
