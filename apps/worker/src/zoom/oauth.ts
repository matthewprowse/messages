// Zoom sign-in (OAuth 2.0, a user-authorised General app on the Zoom Marketplace) with plain HTTPS calls, no
// Zoom SDK. The sign-in is made in the web app (apps/web/app/api/connect/zoom), which stores the refresh token;
// the connector trades it for short-lived access tokens. Like Microsoft, Zoom hands out a new refresh token
// with every access token and each one lasts 90 days, so the connector keeps the newest (see session.ts).
// Zoom's app is a confidential client: the token endpoint takes the client ID and secret as Basic auth.

export const AUTH_URL = "https://zoom.us/oauth/authorize";
export const TOKEN_URL = "https://zoom.us/oauth/token";
/** Where the API lives when a token response does not name its own api_url. */
export const DEFAULT_API_URL = "https://api.zoom.us";

// Granular scopes, chosen on the Marketplace app's Scopes page rather than sent with the sign-in. The same
// list as apps/web/lib/server/zoom.ts. Zoom reports what was granted in the token response's scope.

/** Your own Zoom user: ID, name and email, to label the account and tell your messages from theirs. */
export const USER_SCOPE = "user:read:user";
/** Your cloud recordings and their files, transcripts (VTT) among them. */
export const RECORDINGS_SCOPE = "cloud_recording:read:list_user_recordings";
/** A meeting's details, for its join link. */
export const MEETING_SCOPE = "meeting:read:meeting";
/** Who was in a meeting that has ended. */
export const PARTICIPANTS_SCOPE = "meeting:read:list_past_participants";
/** Your Team Chat conversations, 1:1 and group. */
export const CHAT_SESSIONS_SCOPE = "team_chat:read:list_user_sessions";
/** The messages in them. */
export const CHAT_READ_SCOPE = "team_chat:read:list_user_messages";
/** Send a Team Chat message as you. */
export const CHAT_SEND_SCOPE = "team_chat:write:user_message";

export const SCOPES = [USER_SCOPE, RECORDINGS_SCOPE, MEETING_SCOPE, PARTICIPANTS_SCOPE, CHAT_SESSIONS_SCOPE, CHAT_READ_SCOPE, CHAT_SEND_SCOPE];
/** What each part of the connector needs. Meetings and Team Chat each run when their scopes were granted. */
export const MEETINGS_NEEDS = [RECORDINGS_SCOPE];
export const CHAT_NEEDS = [CHAT_SESSIONS_SCOPE, CHAT_READ_SCOPE];

/** Stored encrypted in account_credentials. */
export interface ZoomCredentials {
  refreshToken: string;
  /** The scopes you agreed to, as Zoom names them. */
  scopes: string[];
  /** Your Zoom user ID and email, from /users/me when you signed in. */
  userId: string;
  email: string;
  /** The API's address for your account's region, from the token response. */
  apiUrl?: string;
}

export function authUrl(opts: { clientId: string; redirectUri: string; state: string; challenge: string }): string {
  const url = new URL(AUTH_URL);
  url.search = new URLSearchParams({
    response_type: "code",
    client_id: opts.clientId,
    redirect_uri: opts.redirectUri,
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
  api_url?: string;
}

/** An error from Zoom's token endpoint. "invalid_grant" means the sign-in was revoked, expired or replaced. */
export class ZoomAuthError extends Error {
  constructor(readonly code: string) {
    super(`zoom token request failed: ${code}`);
  }
}

async function tokenRequest(clientId: string, clientSecret: string, body: Record<string, string>): Promise<TokenResponse> {
  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: {
      authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`,
      "content-type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams(body),
    signal: AbortSignal.timeout(20_000),
  });
  const json = (await response.json().catch(() => ({}))) as TokenResponse & { error?: string };
  if (!response.ok || !json.access_token) throw new ZoomAuthError(json.error ?? `HTTP_${response.status}`);
  return json;
}

export function exchangeCode(opts: { clientId: string; clientSecret: string; code: string; redirectUri: string; verifier: string }) {
  return tokenRequest(opts.clientId, opts.clientSecret, {
    grant_type: "authorization_code",
    code: opts.code,
    redirect_uri: opts.redirectUri,
    code_verifier: opts.verifier,
  });
}

export function refreshAccessToken(opts: { clientId: string; clientSecret: string; refreshToken: string }) {
  return tokenRequest(opts.clientId, opts.clientSecret, { grant_type: "refresh_token", refresh_token: opts.refreshToken });
}

/** The scopes Zoom granted, from the token response's space-separated list. Ones this app does not use are dropped. */
export function grantedScopes(scope: string | undefined): string[] {
  const known = new Set(SCOPES);
  return [...new Set((scope ?? "").split(/[\s,]+/).filter((s) => known.has(s)))];
}

/** The API base for a token response: its api_url when it names a Zoom host over HTTPS, else the default. */
export function apiBase(apiUrl: string | undefined): string {
  if (!apiUrl) return DEFAULT_API_URL;
  try {
    const url = new URL(apiUrl);
    return url.protocol === "https:" && /(^|\.)zoom\.(us|com|com\.cn)$/.test(url.hostname) ? url.origin : DEFAULT_API_URL;
  } catch {
    return DEFAULT_API_URL;
  }
}
