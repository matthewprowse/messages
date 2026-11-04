// Telling a refused sign-up from other sign-in errors. Only approved emails may create an account (migration
// 20261124150100_approved_signups.sql): the database refuses the new user, and Supabase Auth reports that as a generic
// "Database error saving new user", from signInWithOtp directly or, after Google, in the address it sends the browser
// back to. Pure, so it is tested without Supabase.

const REFUSED = /database error saving new user|not on the approved list/i;

/** True when an Auth error message is the database refusing a new account. */
export function isRefusedSignup(message: string | null | undefined): boolean {
  return !!message && REFUSED.test(message);
}

/** The error Auth put in the address after a Google sign-in (query or fragment), or null when there is none. */
export function authErrorInUrl(search: string, hash: string): string | null {
  for (const part of [search.replace(/^\?/, ""), hash.replace(/^#/, "")]) {
    const params = new URLSearchParams(part);
    const text = params.get("error_description") ?? params.get("error");
    if (text) return text;
  }
  return null;
}
