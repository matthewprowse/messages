import { loadCredentials } from "../db";
import { env } from "../env";
import { GoogleClient, signInRevoked } from "./client";
import type { GoogleCredentials } from "./oauth";

// How a Google connector (Gmail, Calendar) starts a session and which failures stop it for good.

/**
 * A client for this account's Google sign-in, once it is known to grant `scope`. Throws NO_CLIENT when the
 * worker has no OAuth client configured, and NOT_GRANTED when the sign-in lacks the scope.
 */
export async function openGoogleClient(accountId: string, scope: string): Promise<{ client: GoogleClient; creds: GoogleCredentials }> {
  const creds = await loadCredentials<GoogleCredentials>(accountId);
  // A refresh token only works with the client that issued it: the app's web client, or the terminal's desktop one.
  const [clientId, clientSecret, names] = creds.client === "web"
    ? [env.googleWebClientId, env.googleWebClientSecret, "GOOGLE_WEB_CLIENT_ID or GOOGLE_WEB_CLIENT_SECRET"]
    : [env.googleClientId, env.googleClientSecret, "GOOGLE_CLIENT_ID or GOOGLE_CLIENT_SECRET"];
  if (!clientId || !clientSecret) throw Object.assign(new Error(`Missing ${names}`), { code: creds.client === "web" ? "NO_WEB_CLIENT" : "NO_CLIENT" });
  if (!creds.scopes.includes(scope)) throw Object.assign(new Error("scope not granted"), { code: "NOT_GRANTED" });
  return { client: new GoogleClient({ clientId, clientSecret, refreshToken: creds.refreshToken }), creds };
}

/**
 * The account status to show when a session failure cannot be fixed by retrying, or null to retry.
 * `product` names what was not granted, e.g. "Gmail" or "Calendar".
 */
export function googleFatalDetail(err: unknown, product: string): string | null {
  if (signInRevoked(err)) return "Google sign-in expired or was removed. Reconnect Google in Settings, Connected Accounts.";
  const code = (err as { code?: string }).code;
  if (code === "NO_CLIENT") return "Add GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET to apps/worker/.env, then restart the worker.";
  if (code === "NO_WEB_CLIENT") return "Add GOOGLE_WEB_CLIENT_ID and GOOGLE_WEB_CLIENT_SECRET to apps/worker/.env, then restart the worker.";
  if (code === "NOT_GRANTED") return `${product} access was not granted. Reconnect Google in Settings, Connected Accounts, and tick the ${product} box.`;
  return null;
}
