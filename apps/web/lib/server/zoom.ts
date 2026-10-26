// Zoom sign-in for connecting Zoom meetings and Team Chat from the app, with plain HTTPS calls like the
// worker's apps/worker/src/zoom/oauth.ts. Zoom's scopes are chosen on the Marketplace app, not here; this lists
// the same ones as the worker's SCOPES, to read the token response by.

const clientId = process.env.ZOOM_CLIENT_ID ?? "";
const clientSecret = process.env.ZOOM_CLIENT_SECRET ?? "";

export const zoomReady = () => !!clientId && !!clientSecret;

export const RECORDINGS_SCOPE = "cloud_recording:read:list_user_recordings";
export const CHAT_SCOPES = ["team_chat:read:list_user_sessions", "team_chat:read:list_user_messages"];
const SCOPES = [
  "user:read:user",
  RECORDINGS_SCOPE,
  "meeting:read:meeting",
  "meeting:read:list_past_participants",
  ...CHAT_SCOPES,
  "team_chat:write:user_message",
];

export function authUrl(opts: { redirectUri: string; state: string; challenge: string }): string {
  const url = new URL("https://zoom.us/oauth/authorize");
  url.search = new URLSearchParams({
    response_type: "code",
    client_id: clientId,
    redirect_uri: opts.redirectUri,
    state: opts.state,
    code_challenge: opts.challenge,
    code_challenge_method: "S256",
  }).toString();
  return url.toString();
}

/** A refusal from Zoom, as its own error code (invalid_grant, invalid_client, ...). */
export class ZoomError extends Error {
  constructor(readonly code: string) {
    super(`zoom request failed: ${code}`);
  }
}

/** The API's address for the account's region, when Zoom names one on its own domain. */
function apiBase(apiUrl: string | undefined): string {
  try {
    const url = new URL(apiUrl ?? "");
    if (url.protocol === "https:" && /(^|\.)zoom\.(us|com|com\.cn)$/.test(url.hostname)) return url.origin;
  } catch {
    // fall through to the default
  }
  return "https://api.zoom.us";
}

export async function exchangeCode(code: string, redirectUri: string, verifier: string) {
  const response = await fetch("https://zoom.us/oauth/token", {
    method: "POST",
    headers: {
      authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`,
      "content-type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({ grant_type: "authorization_code", code, redirect_uri: redirectUri, code_verifier: verifier }),
    signal: AbortSignal.timeout(20_000),
  });
  const json = (await response.json().catch(() => ({}))) as { access_token?: string; refresh_token?: string; scope?: string; api_url?: string; error?: string };
  if (!response.ok || !json.access_token) throw new ZoomError(json.error ?? `http_${response.status}`);
  const scopes = [...new Set((json.scope ?? "").split(/[\s,]+/).filter((s) => SCOPES.includes(s)))];
  return { accessToken: json.access_token, refreshToken: json.refresh_token, scopes, apiUrl: apiBase(json.api_url) };
}

/** Who signed in: their Zoom user ID and email. */
export async function zoomUser(apiUrl: string, accessToken: string): Promise<{ id: string; email: string }> {
  const response = await fetch(`${apiUrl}/v2/users/me`, { headers: { authorization: `Bearer ${accessToken}` }, signal: AbortSignal.timeout(20_000) });
  if (!response.ok) throw new ZoomError(`http_${response.status}`);
  const me = (await response.json()) as { id?: string; email?: string };
  if (!me.id || !me.email) throw new ZoomError("no_user");
  return { id: me.id, email: me.email.toLowerCase() };
}
