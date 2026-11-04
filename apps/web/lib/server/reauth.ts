// Re-authentication for the actions a stolen session must not be able to take (Delete My Account). The person proves it is them
// again with their password, a code from their authenticator app, or a code emailed to them. Each check is one call to
// Supabase Auth's REST API with the publishable key, so nothing is stored and no session is kept; `call` is passed in so the
// rules are tested without a network. Server only.

export type Proof = { method: "password"; password: string } | { method: "totp"; code: string } | { method: "email"; code: string };

/** The proof in a request body, or null when it is missing or malformed. Codes are six to eight digits (Supabase email codes can be eight). */
export function parseProof(value: unknown): Proof | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Record<string, unknown>;
  if (v.method === "password" && typeof v.password === "string" && v.password.length > 0 && v.password.length <= 1024) return { method: "password", password: v.password };
  if ((v.method === "totp" || v.method === "email") && typeof v.code === "string") {
    const code = v.code.replace(/[\s-]/g, "");
    if (/^\d{6,8}$/.test(code)) return { method: v.method, code };
  }
  return null;
}

/** One request to Supabase Auth: the path under /auth/v1, a JSON body, and an optional bearer token. Resolves to the response's JSON and whether it was ok. */
export type AuthCall = (path: string, body: Record<string, unknown>, bearer?: string) => Promise<{ ok: boolean; json: Record<string, unknown> }>;

export interface ProofUser { email?: string | null; factors?: { id: string; factor_type?: string; status?: string }[] | null }

/** True when the proof checks out for this user. A method the user cannot use (no authenticator app, no email) is false, never an error. */
export async function verifyProof(call: AuthCall, user: ProofUser, accessToken: string, proof: Proof): Promise<boolean> {
  try {
    // A person with any second factor (authenticator app, phone, passkey) must use it: a password or a mailbox alone is what
    // two-factor sign-in guards against. Only an authenticator code can be checked in one call here, so someone whose only
    // factors are a phone or a passkey cannot re-authenticate this way yet: refused, never let through on a password.
    const verified = (user.factors ?? []).filter((f) => f.status === "verified");
    const factor = verified.find((f) => f.factor_type === "totp");
    if (verified.length > 0 && proof.method !== "totp") return false;
    if (proof.method === "password") {
      if (!user.email) return false;
      return (await call("token?grant_type=password", { email: user.email, password: proof.password })).ok;
    }
    if (proof.method === "email") {
      if (!user.email) return false;
      return (await call("verify", { type: "email", email: user.email, token: proof.code })).ok;
    }
    if (!factor) return false;
    const challenge = await call(`factors/${encodeURIComponent(factor.id)}/challenge`, {}, accessToken);
    const challengeId = challenge.json.id;
    if (!challenge.ok || typeof challengeId !== "string") return false;
    return (await call(`factors/${encodeURIComponent(factor.id)}/verify`, { challenge_id: challengeId, code: proof.code }, accessToken)).ok;
  } catch {
    return false;
  }
}

/** Asks Supabase to email the person a sign-in code, for someone with no password or authenticator app. Never creates a user. */
export async function sendEmailCode(call: AuthCall, email: string): Promise<boolean> {
  try {
    return (await call("otp", { email, create_user: false })).ok;
  } catch {
    return false;
  }
}
