// Microsoft sign-in for connecting Outlook, Outlook Calendar, Microsoft To Do and Teams from the app, with plain
// HTTPS calls like the worker's apps/worker/src/microsoft/oauth.ts, which this mirrors: the scopes, the sign-in
// address and the stored credentials must stay the same. The app is a public client (PKCE, no secret), so only
// MICROSOFT_CLIENT_ID is needed, the same value as in apps/worker/.env.

import { createHash, randomBytes } from "node:crypto";

export const clientId = process.env.MICROSOFT_CLIENT_ID ?? "";

export const microsoftReady = () => !!clientId;

const LOGIN = "https://login.microsoftonline.com";
const GRAPH_SCOPE_PREFIX = "https://graph.microsoft.com/";
export const GRAPH = "https://graph.microsoft.com/v1.0";

/** MICROSOFT_TENANT as in apps/worker/.env: "common" takes work, school and personal accounts. */
function base(): string {
  return `${LOGIN}/${encodeURIComponent(process.env.MICROSOFT_TENANT || "common")}/oauth2/v2.0`;
}

export const MAIL_SCOPE = "Mail.ReadWrite";
export const SEND_SCOPE = "Mail.Send";
export const CALENDAR_SCOPE = "Calendars.Read";
export const PROFILE_SCOPE = "User.Read";
export const TASKS_SCOPE = "Tasks.ReadWrite";
/** Create, change, answer and delete events. Asked for later, on its own (incremental consent), not on every sign-in. */
export const CALENDAR_WRITE_SCOPE = "Calendars.ReadWrite";
export const CHAT_SCOPE = "Chat.ReadWrite";
export const MEETINGS_SCOPE = "OnlineMeetings.Read";
export const TRANSCRIPT_SCOPE = "OnlineMeetingTranscript.Read.All";
const OFFLINE_SCOPE = "offline_access";

/** Asked for on every sign-in: the worker's SCOPES, plus To Do. These work for personal and work accounts alike. */
export const BASE_SCOPES = [MAIL_SCOPE, SEND_SCOPE, CALENDAR_SCOPE, PROFILE_SCOPE, TASKS_SCOPE];
/** Teams, asked for only when ticked: the same as the worker's TEAMS_SCOPES. Work and school accounts only. */
export const TEAMS_SCOPES = [CHAT_SCOPE, MEETINGS_SCOPE, TRANSCRIPT_SCOPE];

/** Stored encrypted, the same shape as the worker's MicrosoftCredentials. */
export interface MicrosoftCredentials {
  refreshToken: string;
  scopes: string[];
}

/** What a sign-in asks for beyond the base set. */
export function extraScopes(teams: boolean, calendarWrite = false): string[] {
  return [...(teams ? TEAMS_SCOPES : []), ...(calendarWrite ? [CALENDAR_WRITE_SCOPE] : [])];
}

function requestScopes(extra: readonly string[] = []): string {
  return [...new Set([...BASE_SCOPES, ...extra])].map((s) => GRAPH_SCOPE_PREFIX + s).concat(OFFLINE_SCOPE).join(" ");
}

/** Proof that the code exchange comes from the same server that started the sign-in (RFC 7636). */
export function pkce() {
  const verifier = randomBytes(32).toString("base64url");
  return { verifier, challenge: createHash("sha256").update(verifier).digest("base64url") };
}

export function authUrl(opts: { redirectUri: string; state: string; challenge: string; teams?: boolean; calendarWrite?: boolean; clientId?: string }): string {
  const url = new URL(`${base()}/authorize`);
  url.search = new URLSearchParams({
    client_id: opts.clientId ?? clientId,
    redirect_uri: opts.redirectUri,
    response_type: "code",
    response_mode: "query",
    scope: requestScopes(extraScopes(opts.teams === true, opts.calendarWrite === true)),
    prompt: "select_account",
    state: opts.state,
    code_challenge: opts.challenge,
    code_challenge_method: "S256",
  }).toString();
  return url.toString();
}

/** The scopes Microsoft granted, short form, only the ones this app knows (as the worker's grantedScopes). */
export function grantedScopes(scope: string | undefined): string[] {
  const known = new Map([...BASE_SCOPES, ...TEAMS_SCOPES, CALENDAR_WRITE_SCOPE].map((s) => [s.toLowerCase(), s]));
  const out = new Set<string>();
  for (const raw of (scope ?? "").split(/\s+/)) {
    const short = raw.toLowerCase().startsWith(GRAPH_SCOPE_PREFIX) ? raw.slice(GRAPH_SCOPE_PREFIX.length) : raw;
    const name = known.get(short.toLowerCase());
    if (name) out.add(name);
  }
  // Read-write includes read, and Microsoft may list only the broader one.
  if (out.has(CALENDAR_WRITE_SCOPE)) out.add(CALENDAR_SCOPE);
  return [...out];
}

/** Whether Microsoft turned the sign-in away until an IT admin approves the app (AADSTS65001, 90094, 90095). */
export function needsAdminApproval(error: string | null, description: string | null): boolean {
  return error === "consent_required" || /\bAADSTS(?:65001|90094|90095)\b/.test(description ?? "");
}

/** The address an IT admin opens to approve the permissions for everyone in their organisation. */
export function adminConsentUrl(opts: { teams: boolean; calendarWrite?: boolean; clientId?: string }): string {
  const tenant = process.env.MICROSOFT_TENANT || "common";
  const url = new URL(`${LOGIN}/${encodeURIComponent(tenant === "common" ? "organizations" : tenant)}/v2.0/adminconsent`);
  url.search = new URLSearchParams({ client_id: opts.clientId ?? clientId, scope: requestScopes(extraScopes(opts.teams, opts.calendarWrite === true)), redirect_uri: "http://localhost" }).toString();
  return url.toString();
}

export type MicrosoftProvider = "outlook" | "outlook_calendar" | "microsoft_todo" | "teams";

/** Which account rows a set of granted scopes connects, in the order they are saved, with their labels. */
export function accountsFor(scopes: string[]): { provider: MicrosoftProvider; label: string }[] {
  const rows: { provider: MicrosoftProvider; label: string }[] = [];
  if (scopes.includes(MAIL_SCOPE)) rows.push({ provider: "outlook", label: "Outlook" });
  if (scopes.includes(CALENDAR_SCOPE) || scopes.includes(CALENDAR_WRITE_SCOPE)) rows.push({ provider: "outlook_calendar", label: "Outlook Calendar" });
  if (scopes.includes(TASKS_SCOPE)) rows.push({ provider: "microsoft_todo", label: "Microsoft To Do" });
  if (scopes.includes(CHAT_SCOPE)) rows.push({ provider: "teams", label: "Microsoft Teams" });
  return rows;
}

/** A refusal from Microsoft, as its own error code (invalid_grant, consent_required, ...). */
export class MicrosoftError extends Error {
  constructor(readonly code: string) {
    super(`microsoft request failed: ${code}`);
  }
}

export async function exchangeCode(code: string, redirectUri: string, verifier: string, teams: boolean, calendarWrite = false) {
  const response = await fetch(`${base()}/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      client_id: clientId,
      code,
      redirect_uri: redirectUri,
      code_verifier: verifier,
      scope: requestScopes(extraScopes(teams, calendarWrite)),
    }),
    signal: AbortSignal.timeout(20_000),
  });
  const json = (await response.json().catch(() => ({}))) as { access_token?: string; refresh_token?: string; scope?: string; error?: string };
  if (!response.ok || !json.access_token) throw new MicrosoftError(json.error ?? `http_${response.status}`);
  return { accessToken: json.access_token, refreshToken: json.refresh_token, scopes: grantedScopes(json.scope) };
}

/** Who signed in. A personal account has no "mail" field; its sign-in name is its address. */
export async function signedInAddress(accessToken: string): Promise<string | null> {
  const response = await fetch(`${GRAPH}/me?$select=mail,userPrincipalName`, { headers: { authorization: `Bearer ${accessToken}` }, signal: AbortSignal.timeout(20_000) });
  if (!response.ok) throw new MicrosoftError(`http_${response.status}`);
  const me = (await response.json()) as { mail?: string | null; userPrincipalName?: string | null };
  const address = (me.mail || me.userPrincipalName || "").trim().toLowerCase();
  return address.includes("@") ? address : null;
}
