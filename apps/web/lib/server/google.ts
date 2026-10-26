import { createHash, randomBytes } from "node:crypto";

// Google sign-in for connecting Gmail and Google Calendar from the app, with plain HTTPS calls like the
// worker's apps/worker/src/google/oauth.ts. The scopes must stay the same as the worker's SCOPES.

export const clientId = process.env.GOOGLE_WEB_CLIENT_ID ?? "";
const clientSecret = process.env.GOOGLE_WEB_CLIENT_SECRET ?? "";

export const googleReady = () => !!clientId && !!clientSecret;

export const GMAIL_SCOPE = "https://www.googleapis.com/auth/gmail.modify";
export const CALENDAR_SCOPE = "https://www.googleapis.com/auth/calendar.readonly";
const CALENDAR_EVENTS_SCOPE = "https://www.googleapis.com/auth/calendar.events";
const CONTACTS_SCOPE = "https://www.googleapis.com/auth/contacts.readonly";
export const TASKS_SCOPE = "https://www.googleapis.com/auth/tasks";
const SCOPES = [GMAIL_SCOPE, CALENDAR_SCOPE, CALENDAR_EVENTS_SCOPE, CONTACTS_SCOPE, TASKS_SCOPE];
/** Meet Transcripts and Google Chat, asked for only when ticked: the same as the worker's MEET_CHAT_SCOPES. */
export const MEET_SCOPE = "https://www.googleapis.com/auth/meetings.space.readonly";
export const CHAT_MESSAGES_SCOPE = "https://www.googleapis.com/auth/chat.messages";
const MEET_CHAT_SCOPES = [MEET_SCOPE, CHAT_MESSAGES_SCOPE, "https://www.googleapis.com/auth/chat.spaces.readonly", "openid", "email"];

/** Proof that the code exchange comes from the same server that started the sign-in (RFC 7636). */
export function pkce() {
  const verifier = randomBytes(32).toString("base64url");
  return { verifier, challenge: createHash("sha256").update(verifier).digest("base64url") };
}

export function authUrl(opts: { redirectUri: string; state: string; challenge: string; hint?: string; meet?: boolean }): string {
  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.search = new URLSearchParams({
    client_id: clientId,
    redirect_uri: opts.redirectUri,
    response_type: "code",
    scope: (opts.meet ? [...SCOPES, ...MEET_CHAT_SCOPES] : SCOPES).join(" "),
    access_type: "offline", // ask for a refresh token
    prompt: "consent", // always issue a new refresh token, also when reconnecting
    include_granted_scopes: "true",
    state: opts.state,
    code_challenge: opts.challenge,
    code_challenge_method: "S256",
    ...(opts.hint ? { login_hint: opts.hint } : {}),
  }).toString();
  return url.toString();
}

/** A refusal from Google, as its own error code (invalid_grant, invalid_client, ...). */
export class GoogleError extends Error {
  constructor(readonly code: string) {
    super(`google request failed: ${code}`);
  }
}

export async function exchangeCode(code: string, redirectUri: string, verifier: string) {
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "authorization_code", client_id: clientId, client_secret: clientSecret, code, redirect_uri: redirectUri, code_verifier: verifier }),
    signal: AbortSignal.timeout(20_000),
  });
  const json = (await response.json().catch(() => ({}))) as { access_token?: string; refresh_token?: string; scope?: string; error?: string };
  if (!response.ok || !json.access_token) throw new GoogleError(json.error ?? `http_${response.status}`);
  return { accessToken: json.access_token, refreshToken: json.refresh_token, scopes: (json.scope ?? "").split(/\s+/).filter(Boolean) };
}

/** One Google API call with a fresh access token. */
export async function googleGet<T>(url: string, accessToken: string): Promise<T> {
  const response = await fetch(url, { headers: { authorization: `Bearer ${accessToken}` }, signal: AbortSignal.timeout(20_000) });
  if (!response.ok) throw new GoogleError(`http_${response.status}`);
  return (await response.json()) as T;
}
