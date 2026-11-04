// What iCloud asks for while signing in. The iCloud Reminders connector writes the step it is waiting at to
// public.instagram_sign_ins (the one table for sign-in steps, so there is no new schema); this tells the app
// (with nothing in the body) and hands the answer back, encrypted, for the connector to take within seconds:
//   step two_factor, method app   the 6-digit code from an Apple device, or action "sms" for Send a Text Instead
//   step two_factor, method sms   the 6-digit code Apple texted
//   step code, method app         Advanced Data Protection: action "continue" once Access iCloud Data on the Web
//                                 is on, so the connector asks the person's device to approve

import { accountsReady, sealRowJson } from "@/lib/server/accounts";
import { admin, fail, foreignOrigin, limiter, noStore, readJson, signedInUser, textField } from "@/lib/server/request";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CODE = /^[0-9]{6}$/;

const overLimit = limiter(10, 10 * 60_000, { name: "connect-icloud-reminders-code" });

type Step = { step: "code" | "two_factor"; method: "email" | "sms" | "app" | null; attempts: number } | null;

export async function POST(request: Request) {
  if (!accountsReady()) return fail(503, "Connecting iCloud Reminders is not set up on this server yet.");
  if (foreignOrigin(request)) return fail(403, "Not allowed from this site.");
  const user = await signedInUser(request);
  if (!user || !admin) return fail(401, "Sign in first.");

  const body = await readJson(request);
  const accountId = body && textField(body, "accountId");
  if (!body || accountId === null || (body.code !== undefined && typeof body.code !== "string") || (body.action !== undefined && body.action !== "sms" && body.action !== "continue")) {
    return fail(400, "That request could not be read.");
  }
  const code = body.code as string | undefined;
  const action = body.action as "sms" | "continue" | undefined;
  if (!accountId) return fail(400, "Choose the iCloud Reminders account.");
  // The account has to be this user's iCloud Reminders: the step table is shared with other connectors.
  const { data: account } = await admin.from("accounts").select("id").eq("id", accountId).eq("user_id", user.id).eq("provider", "icloud_reminders").maybeSingle();
  if (!account) return Response.json({ step: null } satisfies { step: Step }, { headers: noStore });
  const { data: row, error } = await admin
    .from("instagram_sign_ins")
    .select("account_id, user_id, step, method, attempts")
    .eq("account_id", account.id)
    .maybeSingle();
  if (error) return fail(500, "Could not check the sign-in. Try again.");
  if (!row || row.user_id !== user.id) return Response.json({ step: null } satisfies { step: Step }, { headers: noStore });
  const step = { step: row.step, method: row.method, attempts: row.attempts } as NonNullable<Step>;
  if (code === undefined && action === undefined) return Response.json({ step }, { headers: noStore });

  // Only answers count against the limit; the app asks for the step every few seconds while it waits.
  const wait = await overLimit(user.id);
  if (wait > 0) return fail(429, "Too many tries. Wait a few minutes and try again.", { "Retry-After": String(wait) });

  let answer: string;
  if (action !== undefined) {
    const allowed = (action === "sms" && row.step === "two_factor" && row.method === "app") || (action === "continue" && row.step === "code");
    if (!allowed) return fail(409, "That is not needed right now. Reload this page to see where the sign-in is.");
    answer = action;
  } else {
    answer = (code ?? "").replace(/[\s-]/g, "");
    if (!CODE.test(answer)) return fail(400, "Enter the 6-digit code from Apple.");
  }
  // Sealed under the person's own key and bound to this row's code (lib/server/handoff.ts); the connector opens it.
  let sealed: string;
  try {
    sealed = await sealRowJson(user.id, { table: "instagram_sign_ins", column: "code" }, row.account_id, answer);
  } catch {
    return fail(500, "That could not be saved. Try again.");
  }
  // Only if the step is still the one the person saw, so an answer never lands on a newer prompt.
  const { data: saved, error: saveError } = await admin
    .from("instagram_sign_ins")
    .update({ code: sealed })
    .eq("account_id", row.account_id)
    .eq("user_id", user.id)
    .eq("step", row.step)
    .eq("attempts", row.attempts)
    .select("account_id");
  if (saveError) return fail(500, "That could not be saved. Try again.");
  if (!saved?.length) return fail(409, "Apple moved on to something else. Reload this page to see where the sign-in is.");
  return Response.json({ step }, { headers: noStore });
}
