import { createHash, randomBytes } from "node:crypto";

// Google sign-in (OAuth 2.0) with plain HTTPS calls, no Google SDK. The connect command runs the
// browser sign-in once and stores the refresh token; the connectors trade it for short-lived access tokens.

export const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
export const TOKEN_URL = "https://oauth2.googleapis.com/token";

/** Read, label, archive and send mail. Never permanent deletion. */
export const GMAIL_SCOPE = "https://www.googleapis.com/auth/gmail.modify";
/** Read only: which calendars you have, and their events. */
export const CALENDAR_SCOPE = "https://www.googleapis.com/auth/calendar.readonly";
/** Create events made in Messages. It cannot list calendars, so CALENDAR_SCOPE stays as well. */
export const CALENDAR_EVENTS_SCOPE = "https://www.googleapis.com/auth/calendar.events";
/** Read only: names and photos of your Google contacts, matched to the people in Messages. */
export const CONTACTS_SCOPE = "https://www.googleapis.com/auth/contacts.readonly";
export const SCOPES = [GMAIL_SCOPE, CALENDAR_SCOPE, CALENDAR_EVENTS_SCOPE, CONTACTS_SCOPE];

/** Stored encrypted in account_credentials, shared by the Gmail and Google Calendar accounts. */
export interface GoogleCredentials {
  refreshToken: string;
  /** The scopes you agreed to. Google lets you untick some on the consent screen. */
  scopes: string[];
}

export interface Pkce {
  verifier: string;
  challenge: string;
}

/** Proof that the code exchange comes from the same program that started the sign-in (RFC 7636). */
export function pkce(): Pkce {
  const verifier = randomBytes(32).toString("base64url");
  return { verifier, challenge: createHash("sha256").update(verifier).digest("base64url") };
}

export function authUrl(opts: { clientId: string; redirectUri: string; state: string; challenge: string }): string {
  const url = new URL(AUTH_URL);
  url.search = new URLSearchParams({
    client_id: opts.clientId,
    redirect_uri: opts.redirectUri,
    response_type: "code",
    scope: SCOPES.join(" "),
    access_type: "offline", // ask for a refresh token
    prompt: "consent", // always issue a new refresh token, also when reconnecting
    state: opts.state,
    code_challenge: opts.challenge,
    code_challenge_method: "S256",
  }).toString();
  return url.toString();
}

export interface TokenResponse {
  access_token: string;
  expires_in: number;
  refresh_token?: string;
  scope?: string;
}

/** An error from Google's token endpoint. "invalid_grant" means the sign-in was revoked or expired. */
export class GoogleAuthError extends Error {
  constructor(readonly code: string) {
    super(`google token request failed: ${code}`);
  }
}

async function tokenRequest(body: Record<string, string>): Promise<TokenResponse> {
  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(body),
    signal: AbortSignal.timeout(20_000),
  });
  const json = (await response.json().catch(() => ({}))) as TokenResponse & { error?: string };
  if (!response.ok || !json.access_token) throw new GoogleAuthError(json.error ?? `HTTP_${response.status}`);
  return json;
}

export function exchangeCode(opts: { clientId: string; clientSecret: string; code: string; redirectUri: string; verifier: string }) {
  return tokenRequest({
    grant_type: "authorization_code",
    client_id: opts.clientId,
    client_secret: opts.clientSecret,
    code: opts.code,
    redirect_uri: opts.redirectUri,
    code_verifier: opts.verifier,
  });
}

export function refreshAccessToken(opts: { clientId: string; clientSecret: string; refreshToken: string }) {
  return tokenRequest({
    grant_type: "refresh_token",
    client_id: opts.clientId,
    client_secret: opts.clientSecret,
    refresh_token: opts.refreshToken,
  });
}

/** The scopes Google actually granted, from the token response's space-separated list. */
export function grantedScopes(scope: string | undefined): string[] {
  return (scope ?? "").split(/\s+/).filter(Boolean);
}
