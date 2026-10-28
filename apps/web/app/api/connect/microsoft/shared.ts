/** The Microsoft sign-in in progress, sealed in a cookie between starting it and Microsoft's callback. */
export interface MicrosoftSignIn {
  userId: string;
  state: string;
  verifier: string;
  back: string;
  /** Whether the Teams permissions were asked for too. */
  teams: boolean;
  expires: number;
}

export const MICROSOFT_COOKIE = "konva_microsoft_connect";

/** Where a Microsoft sign-in may return to: the app, where the setup dialog picks it up, or Settings. The first is the default. */
export const MICROSOFT_RETURNS = ["/summary", "/settings/accounts/microsoft"] as const;

/** The value of one cookie from a Cookie header. */
export function readCookie(header: string | null, name: string): string | undefined {
  return header?.split(/;\s*/).find((c) => c.startsWith(`${name}=`))?.slice(name.length + 1) || undefined;
}

/** Why a callback cannot be trusted, or null when the sign-in is the one this browser started. */
export function signInProblem(signIn: MicrosoftSignIn | null, params: URLSearchParams, now: number): "expired" | null {
  if (!signIn || signIn.expires < now || !params.get("state") || params.get("state") !== signIn.state || !params.get("code")) return "expired";
  return null;
}

/** Only an address on Microsoft's own sign-in host is passed back to the page as the admin approval link. */
export function isAdminLink(value: string | null): value is string {
  return !!value && value.startsWith("https://login.microsoftonline.com/");
}
