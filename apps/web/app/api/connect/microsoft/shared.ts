/** The Microsoft sign-in in progress, sealed in a cookie between starting it and Microsoft's callback. */
export interface MicrosoftSignIn {
  userId: string;
  state: string;
  verifier: string;
  back: string;
  /** Whether the Teams permissions were asked for too. */
  teams: boolean;
  /** Whether Calendars.ReadWrite was asked for too, to create and change events (incremental consent). */
  calendarWrite?: boolean;
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

/**
 * True only for Microsoft's admin consent address for this app: https://login.microsoftonline.com/<tenant>/v2.0/adminconsent,
 * the fixed redirect, and when clientId is given, that client id. Anything else is never shown as the link to send an IT
 * admin, since approving someone else's app there would hand it the whole organisation's mail.
 */
export function isAdminLink(value: string | null | undefined, clientId?: string): value is string {
  if (!value) return false;
  try {
    const url = new URL(value);
    return url.origin === "https://login.microsoftonline.com" && /^\/[A-Za-z0-9.-]{1,100}\/v2\.0\/adminconsent$/.test(url.pathname)
      && !url.username && !url.password && !url.hash && url.searchParams.get("redirect_uri") === "http://localhost"
      && !!url.searchParams.get("client_id") && (!clientId || url.searchParams.get("client_id") === clientId);
  } catch {
    return false;
  }
}
