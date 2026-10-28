import { db, must } from "../db";
import { env } from "../env";
import { credentialSealer } from "../vault";
import { errorCode, log } from "../log";
import { ZoomClient, signInRevoked } from "./client";
import type { ZoomCredentials } from "./oauth";

// How the Zoom connector starts a session and which failures stop it for good.
//
// Zoom replaces the refresh token on every refresh, and each one expires 90 days after it was issued. As for
// Microsoft, the newest is kept in account_credentials.refreshed rather than ciphertext: a change to ciphertext
// means "you signed in again" and restarts the connector, and a token refreshed every hour must not. Writes
// are tied to the sign-in they came from (its updated_at), so a connector that is stopping cannot overwrite a
// new sign-in with an older token.

/** A client for this account's Zoom sign-in. Throws NO_CLIENT when the worker has no Zoom app configured. */
export async function openZoomClient(accountId: string): Promise<{ client: ZoomClient; creds: ZoomCredentials }> {
  if (!env.zoomClientId || !env.zoomClientSecret) {
    throw Object.assign(new Error("Missing ZOOM_CLIENT_ID or ZOOM_CLIENT_SECRET"), { code: "NO_CLIENT" });
  }
  const row = must(
    await db.from("account_credentials").select("ciphertext, refreshed, updated_at").eq("account_id", accountId).maybeSingle(),
    "load credentials",
  );
  if (!row) throw Object.assign(new Error("No credentials stored"), { code: "NO_CREDENTIALS" });
  const sealer = await credentialSealer(accountId);
  const signedIn = await sealer.openJson<ZoomCredentials>(row.ciphertext);
  const creds = row.refreshed ? await sealer.openJson<ZoomCredentials>(row.refreshed) : signedIn;

  const keep = async (refreshToken: string) => {
    const { error } = await db
      .from("account_credentials")
      .update({ refreshed: await sealer.sealJson({ ...creds, refreshToken }) })
      .eq("account_id", accountId)
      .eq("updated_at", row.updated_at);
    if (error) log.warn("zoom token not kept", { account: accountId, code: errorCode(error) });
  };
  const client = new ZoomClient(
    { clientId: env.zoomClientId, clientSecret: env.zoomClientSecret, refreshToken: creds.refreshToken, apiUrl: creds.apiUrl },
    keep,
  );
  return { client, creds };
}

/** The account status to show when a session failure cannot be fixed by retrying, or null to retry. */
export function zoomFatalDetail(err: unknown): string | null {
  if (signInRevoked(err)) return "Zoom sign-in expired or was removed. Reconnect Zoom in Settings, Connected Accounts.";
  const code = (err as { code?: string }).code;
  if (code === "NO_CLIENT") return "Add ZOOM_CLIENT_ID and ZOOM_CLIENT_SECRET to apps/worker/.env, then restart the worker.";
  if (code === "NOT_GRANTED") return "Zoom gave no access to recordings or Team Chat. Check the app's scopes, then reconnect Zoom in Settings.";
  return null;
}
