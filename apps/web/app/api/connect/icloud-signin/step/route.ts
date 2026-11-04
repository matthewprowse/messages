// Where the one iCloud sign-in is, for the app to show, and its answers back. The iCloud connector writes the step it
// waits at to the icloud_setups row; this reads it (with nothing in the body), takes a typed code or Send a Text
// Instead, and, once the connector has made the app-specific password, checks it with iCloud and saves Mail, Calendar
// and Reminders exactly as a pasted password and the Reminders sign-in are saved. The row is deleted once used.

import { accountsReady, openRowJson, sealRowJson } from "@/lib/server/accounts";
import { checkCalendar, checkMail, saveMailAndCalendar, startReminders } from "@/lib/server/icloud";
import { admin, fail, foreignOrigin, limiter, noStore, readJson, signedInUser, textField } from "@/lib/server/request";
import { untaken, type ICloudService, type SetupState } from "@/lib/icloud-signin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CODE = /^[0-9]{6}$/;
// A new app-specific password can take a few seconds to reach iCloud Mail.
const MAIL_TRIES = 4;
const MAIL_WAIT_MS = 4_000;

const overLimit = limiter(10, 10 * 60_000, { name: "connect-icloud-signin-code" });

type SignIn = { appleId: string; password: string; mailUser: string; address: string };
type Result = { appPassword: string; trustToken: string | null };

export async function POST(request: Request) {
  if (!accountsReady()) return fail(503, "Connecting iCloud is not set up on this server yet.");
  if (foreignOrigin(request)) return fail(403, "Not allowed from this site.");
  const user = await signedInUser(request);
  if (!user || !admin) return fail(401, "Sign in first.");

  const body = await readJson(request);
  const setupId = body && textField(body, "setupId");
  if (!body || !setupId || (body.code !== undefined && typeof body.code !== "string") || (body.action !== undefined && body.action !== "sms")) {
    return fail(400, "That request could not be read.");
  }
  const { data: row, error } = await admin
    .from("icloud_setups")
    .select("id, status, step, method, attempts, detail, error, services, created_at")
    .eq("id", setupId)
    .eq("user_id", user.id)
    .maybeSingle();
  if (error) return fail(500, "Could not check the sign-in. Try again.");
  if (!row) return Response.json({ status: "failed", error: "This sign-in has ended. Connect again." } satisfies SetupState, { headers: noStore });

  if (body.code !== undefined || body.action !== undefined) {
    const wait = await overLimit(user.id);
    if (wait > 0) return fail(429, "Too many tries. Wait a few minutes and try again.", { "Retry-After": String(wait) });
    if (row.step !== "two_factor") return fail(409, "That is not needed right now.");
    let answer: string;
    if (body.action === "sms") {
      if (row.method !== "app") return fail(409, "Apple is already texting the code.");
      answer = "sms";
    } else {
      answer = String(body.code).replace(/[\s-]/g, "");
      if (!CODE.test(answer)) return fail(400, "Enter the 6-digit code from Apple.");
    }
    // Only if the step is still the one the person saw, so an answer never lands on a newer prompt.
    let sealed: string;
    try {
      sealed = await sealRowJson(user.id, { table: "icloud_setups", column: "code" }, row.id, answer);
    } catch {
      return fail(500, "That could not be sent. Try again.");
    }
    const { data: saved, error: saveError } = await admin
      .from("icloud_setups")
      .update({ code: sealed })
      .eq("id", row.id)
      .eq("step", row.step)
      .eq("attempts", row.attempts)
      .select("id");
    if (saveError) return fail(500, "That could not be sent. Try again.");
    if (!saved?.length) return fail(409, "Apple moved on to something else. Wait a moment.");
    return Response.json({ status: "working", detail: "Checking the code with Apple." } satisfies SetupState, { headers: noStore });
  }

  if (row.status === "failed") return Response.json({ status: "failed", error: row.error ?? "iCloud could not be connected. Connect again." } satisfies SetupState, { headers: noStore });
  if (row.status === "ready") return Response.json(await finish(user.id, row.id), { headers: noStore });
  if (row.status === "queued" && untaken(row.created_at)) {
    await admin.from("icloud_setups").delete().eq("id", row.id).eq("status", "queued");
    return Response.json({ status: "failed", error: "Konva's iCloud service did not pick up the sign-in. Nothing was sent to Apple. Try again in a few minutes." } satisfies SetupState, { headers: noStore });
  }
  if (row.step === "two_factor") return Response.json({ status: "code", method: row.method as "app" | "sms" | null, attempts: row.attempts, detail: row.detail } satisfies SetupState, { headers: noStore });
  return Response.json({ status: "working", detail: row.detail } satisfies SetupState, { headers: noStore });
}

/** Takes the made password (once: the row moves to done first), checks it with iCloud and saves the accounts. */
async function finish(userId: string, setupId: string): Promise<SetupState> {
  if (!admin) return { status: "failed", error: "iCloud could not be connected. Connect again." };
  const { data: claimed } = await admin
    .from("icloud_setups")
    .update({ status: "done", detail: "Connecting Mail and Calendar.", updated_at: new Date().toISOString() })
    .eq("id", setupId)
    .eq("status", "ready")
    .select("services, sign_in, result");
  const row = claimed?.[0];
  if (!row?.result) return { status: "working", detail: "Connecting Mail and Calendar." };

  const end = async (state: SetupState) => {
    if (state.status === "failed") await admin?.from("icloud_setups").update({ status: "failed", error: state.error, sign_in: "", result: null }).eq("id", setupId);
    else await admin?.from("icloud_setups").delete().eq("id", setupId);
    return state;
  };
  let signIn: SignIn;
  let result: Result;
  try {
    signIn = await openRowJson<SignIn>(userId, { table: "icloud_setups", column: "sign_in" }, setupId, row.sign_in);
    result = await openRowJson<Result>(userId, { table: "icloud_setups", column: "result" }, setupId, row.result);
  } catch {
    return end({ status: "failed", error: "The sign-in could not be read. Connect again." });
  }
  const services = new Set(row.services as ICloudService[]);
  const password = result.appPassword.replace(/\s+/g, "");

  let mail = false;
  if (services.has("mail")) {
    let check: Awaited<ReturnType<typeof checkMail>> = "rejected";
    for (let i = 0; i < MAIL_TRIES; i++) {
      check = await checkMail(signIn.mailUser, password);
      if (check === "ok") break;
      if (i < MAIL_TRIES - 1) await new Promise((r) => setTimeout(r, MAIL_WAIT_MS));
    }
    if (check === "rejected") return end({ status: "failed", error: `iCloud Mail did not accept ${signIn.mailUser}. Check it is your iCloud Mail address, then connect again.` });
    if (check === "unreachable") return end({ status: "failed", error: "Could not reach iCloud Mail. Connect again in a moment." });
    mail = true;
  }
  const calendar = services.has("calendar") && (await checkCalendar(signIn.mailUser, password));
  if (!mail && !calendar) return end({ status: "failed", error: "iCloud Calendar did not accept the new password. Connect again in a moment." });

  try {
    await saveMailAndCalendar(userId, { username: signIn.mailUser, address: signIn.address || signIn.mailUser, password, mail, calendar });
    const remindersAccountId = services.has("reminders") ? await startReminders(userId, signIn.appleId, signIn.password, result.trustToken) : null;
    return end({ status: "done", connected: { mail, calendar, remindersAccountId } });
  } catch {
    return end({ status: "failed", error: "Signed in, but the accounts could not be saved. Connect again." });
  }
}
