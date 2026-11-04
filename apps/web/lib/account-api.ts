"use client";

// The browser's calls to /api/account/*: ask for Delete My Account, cancel it, and have a confirmation code emailed. Each
// sends the person's own access token, as /api/keys does, and turns a failure into a sentence the page can show as it is.

import { supabase } from "./supabase";

export type Proof = { method: "password"; password: string } | { method: "totp" | "email"; code: string };

async function call(path: string, method: "POST" | "DELETE", body?: unknown): Promise<{ ok: true; json: Record<string, unknown> } | { ok: false; error: string }> {
  const token = (await supabase.auth.getSession()).data.session?.access_token;
  if (!token) return { ok: false, error: "Sign in again, then try once more." };
  try {
    const res = await fetch(`/api/account/${path}`, { method, headers: { Authorization: `Bearer ${token}`, ...(body ? { "Content-Type": "application/json" } : {}) }, body: body ? JSON.stringify(body) : undefined, cache: "no-store" });
    const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    return res.ok ? { ok: true, json } : { ok: false, error: typeof json.error === "string" ? json.error : "Something went wrong. Try again." };
  } catch {
    return { ok: false, error: "Could not reach Konva. Check your connection and try again." };
  }
}

/** Asks to delete everything after the grace period. Resolves to when it will happen, or why it could not be asked. */
export async function requestDeletion(proof: Proof, confirm: string): Promise<{ runAfter: string } | { error: string }> {
  const r = await call("delete", "POST", { confirm, proof });
  return r.ok ? { runAfter: String(r.json.runAfter) } : { error: r.error };
}

/** Cancels a request that has not started, with the same proof as asking. Resolves to an error sentence, or null. */
export async function cancelDeletion(proof: Proof): Promise<string | null> {
  const r = await call("delete", "DELETE", { proof });
  return r.ok ? null : r.error;
}

/** Emails a one-time code to the signed-in address. Resolves to an error sentence, or null. */
export async function sendReauthCode(): Promise<string | null> {
  const r = await call("reauth", "POST", {});
  return r.ok ? null : r.error;
}
