import { db, must } from "../db";
import { decryptJson, encryptJson } from "../crypto";
import { env } from "../env";
import { errorCode, log } from "../log";
import { GraphClient, signInRevoked } from "./client";
import { optionalGranted, type MicrosoftCredentials } from "./oauth";

// How a Microsoft connector (Outlook, Outlook Calendar, Teams, To Do) starts a session and which failures stop it for good.
//
// Microsoft replaces the refresh token on every refresh, and each one expires 90 days after it was issued.
// The newest is kept in account_credentials.refreshed rather than ciphertext: a change to ciphertext means
// "you signed in again" and restarts the connector, and a token refreshed every hour must not. Writes are
// tied to the sign-in they came from (its updated_at), so a connector that is stopping cannot overwrite a
// new sign-in with an older token.

/**
 * A client for this account's Microsoft sign-in, once it is known to grant every scope in `scopes`. Throws
 * NO_CLIENT when the worker has no Microsoft app configured, and NOT_GRANTED when the sign-in lacks a scope.
 */
export async function openGraphClient(accountId: string, scopes: string[]): Promise<{ client: GraphClient; creds: MicrosoftCredentials }> {
  if (!env.microsoftClientId) {
    throw Object.assign(new Error("Missing MICROSOFT_CLIENT_ID"), { code: "NO_CLIENT" });
  }
  const row = must(
    await db.from("account_credentials").select("ciphertext, refreshed, updated_at").eq("account_id", accountId).maybeSingle(),
    "load credentials",
  );
  if (!row) throw Object.assign(new Error("No credentials stored"), { code: "NO_CREDENTIALS" });
  const signedIn = decryptJson<MicrosoftCredentials>(row.ciphertext, env.encryptionKey);
  const creds = row.refreshed ? decryptJson<MicrosoftCredentials>(row.refreshed, env.encryptionKey) : signedIn;
  if (scopes.some((s) => !creds.scopes.includes(s))) throw Object.assign(new Error("scope not granted"), { code: "NOT_GRANTED" });

  const keep = async (refreshToken: string) => {
    const { error } = await db
      .from("account_credentials")
      .update({ refreshed: encryptJson({ ...creds, refreshToken }, env.encryptionKey) })
      .eq("account_id", accountId)
      .eq("updated_at", row.updated_at);
    if (error) log.warn("microsoft token not kept", { account: accountId, code: errorCode(error) });
  };
  const client = new GraphClient(
    { clientId: env.microsoftClientId, clientSecret: env.microsoftClientSecret, refreshToken: creds.refreshToken, extraScopes: optionalGranted(creds.scopes) },
    keep,
  );
  return { client, creds };
}

/**
 * The account status to show when a session failure cannot be fixed by retrying, or null to retry.
 * `product` names what was not granted, e.g. "Mail" or "Calendar".
 */
export function microsoftFatalDetail(err: unknown, product: string): string | null {
  if (signInRevoked(err)) return "Microsoft sign-in expired or was removed. Run pnpm connect:microsoft to reconnect.";
  const code = (err as { code?: string }).code;
  if (code === "NO_CLIENT") return "Add MICROSOFT_CLIENT_ID to apps/worker/.env, then restart the worker.";
  if (code === "NOT_GRANTED") return `${product} access was not granted. Run pnpm connect:microsoft and accept every permission.`;
  return null;
}
