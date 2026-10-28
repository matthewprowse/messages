// Instagram Login for Business and Creator accounts (the official Instagram API), with plain HTTPS calls like
// zoom.ts. The access token it ends in is stored encrypted as the account's credentials, kind "official", and
// the Instagram connector in apps/ai (ai/connectors/instagram/official.py) reads and answers messages with it.
// Meta's app (id and secret) is the operator's, set once in the environment; nobody else ever sees them.

const appId = process.env.INSTAGRAM_APP_ID ?? "";
const appSecret = process.env.INSTAGRAM_APP_SECRET ?? "";

export const instagramReady = () => !!appId && !!appSecret;

/** What Konva asks for: the account's name and type, and its messages. Keep in step with the Meta app's permissions. */
export const BASIC_SCOPE = "instagram_business_basic";
export const MESSAGES_SCOPE = "instagram_business_manage_messages";
const SCOPES = [BASIC_SCOPE, MESSAGES_SCOPE];

/** Meta's API version for calls made here. The connector's own is in ai/connectors/instagram/graph.py. */
const VERSION = "v25.0";

export function authUrl(opts: { redirectUri: string; state: string }): string {
  const url = new URL("https://www.instagram.com/oauth/authorize");
  url.search = new URLSearchParams({
    client_id: appId,
    redirect_uri: opts.redirectUri,
    response_type: "code",
    scope: SCOPES.join(","),
    state: opts.state,
    // Only Instagram's own sign-in: Konva stores an Instagram token, so there is no Facebook Login to offer.
    enable_fb_login: "0",
  }).toString();
  return url.toString();
}

/** A refusal from Instagram, as a short code (invalid_grant, http_400, ...). */
export class InstagramError extends Error {
  constructor(readonly code: string) {
    super(`instagram request failed: ${code}`);
  }
}

async function json<T>(response: Response): Promise<T & { error?: unknown; error_type?: string; error_message?: string }> {
  return (await response.json().catch(() => ({}))) as T & { error?: unknown; error_type?: string; error_message?: string };
}

/** Trades the one-time code for a short-lived token. The code may arrive with a trailing "#_" that is not part of it. */
export async function exchangeCode(code: string, redirectUri: string) {
  const response = await fetch("https://api.instagram.com/oauth/access_token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: appId, client_secret: appSecret, grant_type: "authorization_code", redirect_uri: redirectUri, code: code.replace(/#_$/, "") }),
    signal: AbortSignal.timeout(20_000),
  });
  const body = await json<{ access_token?: string; user_id?: string | number; permissions?: string | string[]; data?: { access_token?: string; user_id?: string | number; permissions?: string | string[] }[] }>(response);
  // Meta documents the answer as { data: [ ... ] } and has also sent the entry on its own.
  const entry = body.data?.[0] ?? body;
  if (!response.ok || !entry.access_token) throw new InstagramError(body.error_type ?? `http_${response.status}`);
  const permissions = Array.isArray(entry.permissions) ? entry.permissions : (entry.permissions ?? "").split(/[\s,]+/);
  return { accessToken: entry.access_token, scopes: permissions.filter((p) => SCOPES.includes(p)) };
}

/** Swaps the short-lived token for one that lasts 60 days (the connector renews it before then). */
export async function longLivedToken(shortToken: string) {
  const url = new URL("https://graph.instagram.com/access_token");
  url.search = new URLSearchParams({ grant_type: "ig_exchange_token", client_secret: appSecret, access_token: shortToken }).toString();
  const response = await fetch(url, { signal: AbortSignal.timeout(20_000) });
  const body = await json<{ access_token?: string; expires_in?: number }>(response);
  if (!response.ok || !body.access_token) throw new InstagramError(`http_${response.status}`);
  return { accessToken: body.access_token, expiresAt: Math.floor(Date.now() / 1000) + (body.expires_in ?? 60 * 24 * 3600) };
}

/** Who signed in: the professional account's ID (the one its messages carry), username and type. */
export async function instagramAccount(accessToken: string): Promise<{ userId: string; username: string; type: string }> {
  const url = new URL(`https://graph.instagram.com/${VERSION}/me`);
  url.search = new URLSearchParams({ fields: "user_id,username,account_type" }).toString();
  const response = await fetch(url, { headers: { authorization: `Bearer ${accessToken}` }, signal: AbortSignal.timeout(20_000) });
  if (!response.ok) throw new InstagramError(`http_${response.status}`);
  const me = (await response.json()) as { user_id?: string | number; id?: string | number; username?: string; account_type?: string };
  const userId = String(me.user_id ?? me.id ?? "");
  if (!userId || !me.username) throw new InstagramError("no_user");
  return { userId, username: me.username.toLowerCase(), type: String(me.account_type ?? "").toUpperCase() };
}
