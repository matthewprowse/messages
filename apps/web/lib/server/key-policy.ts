// Who may be handed their keys, or act through any API route (signedInUser in request.ts applies it to every one). Pure, so
// the rule is tested without a server: a user with a verified second factor of any type (authenticator app, phone,
// passkey) must hold an aal2 session (they passed the code check this session), otherwise a stolen password or magic link
// alone would still open every message. Users with no factor are unchanged, so turning this on locks nobody out.

interface FactorLike { status?: string; factor_type?: string }

/** The `aal` claim of a Supabase access token, or null when it cannot be read. The token's signature is checked by getUser first; this only reads. */
export function tokenAal(token: string): "aal1" | "aal2" | null {
  try {
    const part = token.split(".")[1];
    if (!part) return null;
    const json = JSON.parse(Buffer.from(part.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8")) as { aal?: unknown };
    return json.aal === "aal1" || json.aal === "aal2" ? json.aal : null;
  } catch {
    return null;
  }
}

export type KeyAccess = { ok: true } | { ok: false; status: 401; message: string };

/** Refuses when the user has a verified factor, whatever its type, and the session is not aal2. An unreadable level counts as aal1. */
export function keyAccess(factors: FactorLike[] | null | undefined, aal: string | null): KeyAccess {
  const enrolled = (factors ?? []).some((f) => f.status === "verified");
  if (!enrolled || aal === "aal2") return { ok: true };
  return { ok: false, status: 401, message: "Enter your two-factor code to continue." };
}
