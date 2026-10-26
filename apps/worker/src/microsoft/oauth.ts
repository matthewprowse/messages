// Microsoft sign-in (OAuth 2.0 on the Microsoft identity platform) with plain HTTPS calls, no Microsoft
// SDK. Like Google, the connect command runs the browser sign-in once and stores the refresh token. Unlike
// Google, Microsoft hands out a new refresh token with every access token and each one lasts 90 days, so
// the connectors keep the newest (see session.ts). The app is a public client: PKCE proves the sign-in,
// so no client secret is needed.

const LOGIN = "https://login.microsoftonline.com";

/**
 * MICROSOFT_TENANT from apps/worker/.env: "common" (the default) takes work, school and personal Microsoft
 * accounts; a tenant ID takes only that organisation's. Read here rather than through env.ts so this
 * module stays free of the worker's required settings and can be unit tested.
 */
export function authUrlBase(): string {
  return `${LOGIN}/${encodeURIComponent(process.env.MICROSOFT_TENANT || "common")}/oauth2/v2.0`;
}

const GRAPH = "https://graph.microsoft.com/";

/** Read, move and flag mail. Never permanent deletion: the connector only moves mail to Deleted Items. */
export const MAIL_SCOPE = "Mail.ReadWrite";
/** Send mail as you. */
export const SEND_SCOPE = "Mail.Send";
/** Read only: your calendars and their events. */
export const CALENDAR_SCOPE = "Calendars.Read";
/** Your own name and address, to label the account. */
export const PROFILE_SCOPE = "User.Read";
/** Without it Microsoft issues no refresh token. */
const OFFLINE_SCOPE = "offline_access";

export const SCOPES = [MAIL_SCOPE, SEND_SCOPE, CALENDAR_SCOPE, PROFILE_SCOPE];

/** Teams: read your chats, send replies, and mark a chat read when you open it in the app. */
export const CHAT_SCOPE = "Chat.ReadWrite";
/** Teams: find a meeting from its join link. */
export const MEETINGS_SCOPE = "OnlineMeetings.Read";
/** Teams: read meeting transcripts. Most organisations need an IT admin to approve this one. */
export const TRANSCRIPT_SCOPE = "OnlineMeetingTranscript.Read.All";
/**
 * Asked for only when Teams is chosen in pnpm connect:microsoft, on top of SCOPES: an organisation that
 * needs an admin to approve them would otherwise block the Outlook sign-in too.
 */
export const TEAMS_SCOPES = [CHAT_SCOPE, MEETINGS_SCOPE, TRANSCRIPT_SCOPE];
/** Microsoft To Do: your lists and tasks, and ticking tasks off. */
export const TASKS_SCOPE = "Tasks.ReadWrite";
/** Asked for only when you choose them in pnpm connect:microsoft, on top of SCOPES. */
export const OPTIONAL_SCOPES = [...TEAMS_SCOPES, TASKS_SCOPE];

/** Stored encrypted in account_credentials, shared by the Outlook, Outlook Calendar, Teams and Microsoft To Do accounts. */
export interface MicrosoftCredentials {
  refreshToken: string;
  /** The scopes you agreed to, short form ("Mail.ReadWrite"). */
  scopes: string[];
}

/**
 * Graph scopes as Microsoft wants them in a request: SCOPES plus any optional ones chosen. A refresh must
 * ask for no more than the sign-in agreed to, so it passes the optional scopes that sign-in granted.
 */
function requestScopes(extra: readonly string[] = []): string {
  return [...new Set([...SCOPES, ...extra])].map((s) => GRAPH + s).concat(OFFLINE_SCOPE).join(" ");
}

/** The optional scopes among these, to ask for again on a refresh. */
export function optionalGranted(scopes: string[]): string[] {
  return OPTIONAL_SCOPES.filter((s) => scopes.includes(s));
}

export function authUrl(opts: { clientId: string; redirectUri: string; state: string; challenge: string; extraScopes?: string[] }): string {
  const url = new URL(`${authUrlBase()}/authorize`);
  url.search = new URLSearchParams({
    client_id: opts.clientId,
    redirect_uri: opts.redirectUri,
    response_type: "code",
    response_mode: "query",
    scope: requestScopes(opts.extraScopes),
    prompt: "select_account", // pick which Microsoft account, also when one is already signed in
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

/**
 * An error from Microsoft's token endpoint. "invalid_grant" means the sign-in was revoked or expired;
 * "interaction_required" means Microsoft wants you to sign in again (new consent, MFA or a policy).
 */
export class MicrosoftAuthError extends Error {
  constructor(readonly code: string) {
    super(`microsoft token request failed: ${code}`);
  }
}

async function tokenRequest(body: Record<string, string>): Promise<TokenResponse> {
  const response = await fetch(`${authUrlBase()}/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(body),
    signal: AbortSignal.timeout(20_000),
  });
  const json = (await response.json().catch(() => ({}))) as TokenResponse & { error?: string };
  if (!response.ok || !json.access_token) throw new MicrosoftAuthError(json.error ?? `HTTP_${response.status}`);
  return json;
}

/** A client secret is sent only when one is configured; a public client has none. */
function secret(clientSecret: string): Record<string, string> {
  return clientSecret ? { client_secret: clientSecret } : {};
}

export function exchangeCode(opts: { clientId: string; clientSecret: string; code: string; redirectUri: string; verifier: string; extraScopes?: string[] }) {
  return tokenRequest({
    grant_type: "authorization_code",
    client_id: opts.clientId,
    ...secret(opts.clientSecret),
    code: opts.code,
    redirect_uri: opts.redirectUri,
    code_verifier: opts.verifier,
    scope: requestScopes(opts.extraScopes),
  });
}

/** `extraScopes` are the ones the sign-in granted beyond SCOPES, so a refreshed token keeps them. */
export function refreshAccessToken(opts: { clientId: string; clientSecret: string; refreshToken: string; extraScopes?: string[] }) {
  return tokenRequest({
    grant_type: "refresh_token",
    client_id: opts.clientId,
    ...secret(opts.clientSecret),
    refresh_token: opts.refreshToken,
    scope: requestScopes(opts.extraScopes),
  });
}

/**
 * The Graph scopes Microsoft actually granted, short form. It may list them as
 * "https://graph.microsoft.com/Mail.Read" or "Mail.Read", in any case; OpenID scopes are dropped.
 */
export function grantedScopes(scope: string | undefined): string[] {
  const known = new Map([...SCOPES, ...OPTIONAL_SCOPES].map((s) => [s.toLowerCase(), s]));
  const out = new Set<string>();
  for (const raw of (scope ?? "").split(/\s+/)) {
    const short = raw.toLowerCase().startsWith(GRAPH) ? raw.slice(GRAPH.length) : raw;
    const name = known.get(short.toLowerCase());
    if (name) out.add(name);
  }
  return [...out];
}

/**
 * Whether a sign-in Microsoft turned away needs an IT admin to approve the app first: AADSTS65001 (not
 * consented), AADSTS90094 (admin consent required) or AADSTS90095 (approval requested from the admin).
 */
export function needsAdminApproval(error: string | null, description: string | null): boolean {
  return error === "consent_required" || /\bAADSTS(?:65001|90094|90095)\b/.test(description ?? "");
}

/**
 * The address an IT admin opens to approve these scopes for everyone in their organisation. It returns to
 * the registered http://localhost, where nothing is listening, so that last page may not load; the approval
 * is saved regardless.
 */
export function adminConsentUrl(opts: { clientId: string; scopes: string[] }): string {
  const tenant = process.env.MICROSOFT_TENANT || "common";
  // Only an organisation can approve for its people, so "common" becomes "organizations" here.
  const url = new URL(`${LOGIN}/${encodeURIComponent(tenant === "common" ? "organizations" : tenant)}/v2.0/adminconsent`);
  url.search = new URLSearchParams({ client_id: opts.clientId, scope: requestScopes(opts.scopes), redirect_uri: "http://localhost" }).toString();
  return url.toString();
}
