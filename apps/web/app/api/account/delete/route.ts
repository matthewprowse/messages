// Delete My Account (docs/PLAN.md, "Deleting an account"). POST asks for it: the person must type DELETE and prove who they
// are again (password, authenticator code or emailed code), and a request is then written with a 7 day grace period for the
// sync worker to carry out. DELETE cancels a request that has not started. Nothing is deleted here: the worker does it, after
// the grace period, with the service role. A team owner with other members must hand the team over first.

import { runAfterFor, isDeleteWord } from "@/lib/account-deletion";
import { authCall } from "@/lib/server/auth-call";
import { parseProof, verifyProof } from "@/lib/server/reauth";
import { admin, fail, foreignOrigin, limiter, noStore, readJson, signedInUser } from "@/lib/server/request";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// 5 tries in 15 minutes, so the route cannot be used to guess a password or a code.
const overLimit = limiter(5, 15 * 60_000, { name: "account-delete", perAddress: 20 });

export async function POST(request: Request) {
  if (!admin || !authCall) return fail(503, "This is not set up on the server.");
  if (foreignOrigin(request)) return fail(403, "Not allowed from this site.");
  const user = await signedInUser(request);
  if (!user) return fail(401, "Sign in first.");
  const wait = await overLimit(user.id, request);
  if (wait > 0) return fail(429, "Too many tries. Try again shortly.", { "Retry-After": String(wait) });

  const body = await readJson(request);
  if (!body || typeof body.confirm !== "string" || !isDeleteWord(body.confirm)) return fail(400, "Type DELETE to confirm.");
  const proof = parseProof(body.proof);
  if (!proof) return fail(400, "Confirm it is you first.");
  const token = request.headers.get("authorization")?.match(/^Bearer\s+(\S+)$/i)?.[1] ?? "";
  if (!(await verifyProof(authCall, user, token, proof))) return fail(403, "That did not match. Check it and try again.");

  // A team with other members would be left with no owner: hand it over first.
  const owned = await admin.from("workspaces").select("id").eq("owner_id", user.id);
  if (owned.error) return fail(500, "Could not check your teams. Try again.");
  if (owned.data.length > 0) {
    const others = await admin.from("workspace_members").select("user_id", { count: "exact", head: true })
      .in("workspace_id", owned.data.map((w) => w.id)).eq("status", "active").neq("user_id", user.id);
    if (others.error) return fail(500, "Could not check your teams. Try again.");
    if ((others.count ?? 0) > 0) return fail(409, "You own a team that still has members. Hand the team over or remove its members first.");
  }

  // An existing pending request keeps its date, so asking twice never pushes the deletion further away.
  const existing = await admin.from("account_deletions").select("run_after, status").eq("user_id", user.id).maybeSingle();
  if (existing.error) return fail(500, "Could not save your request. Try again.");
  if (existing.data && existing.data.status !== "failed") return Response.json({ runAfter: existing.data.run_after }, { headers: noStore });
  const runAfter = runAfterFor(Date.now());
  const saved = await admin.from("account_deletions").upsert({ user_id: user.id, run_after: runAfter, status: "pending", attempts: 0, error_code: null, started_at: null }, { onConflict: "user_id" });
  if (saved.error) return fail(500, "Could not save your request. Try again.");
  return Response.json({ runAfter }, { headers: noStore });
}

export async function DELETE(request: Request) {
  if (!admin) return fail(503, "This is not set up on the server.");
  if (foreignOrigin(request)) return fail(403, "Not allowed from this site.");
  const user = await signedInUser(request);
  if (!user) return fail(401, "Sign in first.");
  // Only a request the worker has not started: once it is running the data is already going.
  const gone = await admin.from("account_deletions").delete().eq("user_id", user.id).neq("status", "running").select("user_id");
  if (gone.error) return fail(500, "Could not cancel. Try again.");
  if (gone.data.length === 0) return fail(409, "There is nothing to cancel, or it has already started.");
  return Response.json({ cancelled: true }, { headers: noStore });
}
