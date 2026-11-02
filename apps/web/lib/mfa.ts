// Two-factor sign-in helpers that need no browser: reading the assurance level and picking the factor to challenge.
// The Supabase calls live in auth.tsx, login/page.tsx and components/settings/two-factor.tsx.

interface Level { currentLevel: string | null; nextLevel: string | null }
interface FactorLike { id: string; factor_type?: string; status?: string }

/** True when the session passed only the first step but the user has a verified factor, so the app must hold back until the code is entered. */
export function needsSecondFactor(level: Level | null | undefined): boolean {
  return !!level && level.nextLevel === "aal2" && level.currentLevel !== "aal2";
}

/** The verified authenticator-app factors, oldest first as listed. */
export function verifiedTotp<T extends FactorLike>(factors: T[] | null | undefined): T[] {
  return (factors ?? []).filter((f) => f.factor_type === "totp" && f.status === "verified");
}

/** The six digits typed or pasted (spaces and dashes allowed), or null when it is not six digits. */
export function cleanCode(input: string): string | null {
  const digits = input.replace(/[\s-]/g, "");
  return /^\d{6}$/.test(digits) ? digits : null;
}
