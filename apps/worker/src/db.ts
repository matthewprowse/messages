import { createClient, type PostgrestSingleResponse } from "@supabase/supabase-js";
import type { AccountStatus, Database, Tables } from "@messages/db";
import { env } from "./env";
import { cleanProps, type EventName, type Events } from "@messages/analytics";
import { decryptJson } from "./crypto";

// The worker uses the service role: it bypasses row-level security, so every query here
// must scope by account or user explicitly.
export const db = createClient<Database>(env.supabaseUrl, env.serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

export type AccountRow = Tables<"accounts">;

/**
 * Throws on a Supabase error and returns the data otherwise. Typed against the success branch, so
 * .single() gives a row and .maybeSingle() gives a row or null.
 */
export function must<T>(result: PostgrestSingleResponse<T>, what: string): T {
  if (result.error) {
    const err = new Error(`${what} failed`) as Error & { code?: string };
    err.code = result.error.code;
    throw err;
  }
  return result.data;
}

/**
 * Records a content-free usage event for someone (see @messages/analytics). Fire and forget: it never throws and
 * never waits, and the database drops it when they turned off Share Usage Data.
 */
export function recordEvent<K extends EventName>(userId: string, name: K, props: Events[K]) {
  void Promise.resolve(db.rpc("analytics_record", { p_user: userId, p_events: [{ name, props: cleanProps(props as Record<string, unknown>) }] })).then(
    () => undefined,
    () => undefined,
  );
}

/** A reason shown to people, as a short code word for the analytics. The words themselves are never recorded. */
export function failureCode(reason: string): string {
  const r = reason.toLowerCase();
  if (r.includes("interrupted")) return "interrupted";
  if (r.includes("attach")) return "attachment";
  if (r.includes("needs attention") || r.includes("reconnect")) return "account_needs_attention";
  if (r.includes("recorded")) return "not_recorded";
  return "send_failed";
}

export async function setAccountStatus(accountId: string, status: AccountStatus, detail: string | null = null) {
  const before = await db.from("accounts").select("user_id, provider, status, created_at, last_synced_at").eq("id", accountId).maybeSingle();
  const patch: Database["public"]["Tables"]["accounts"]["Update"] = { status, status_detail: detail };
  if (status === "connected") patch.last_synced_at = new Date().toISOString();
  must(await db.from("accounts").update(patch).eq("id", accountId), "update account status");
  const prev = before.data;
  if (!prev || prev.status === status) return;
  const { user_id: user, provider } = prev;
  if (status === "error") {
    recordEvent(user, "sync_error", { provider, code: "account_error" });
    if (prev.status === "connecting") recordEvent(user, "account_connect", { provider, step: "sync", outcome: "failed", code: "connect_failed" });
  } else if (status === "connected") {
    if (prev.status === "connecting") recordEvent(user, "account_connect", { provider, step: "sync", outcome: "done" });
    if (!prev.last_synced_at) recordEvent(user, "first_sync_done", { provider, secs: Math.round(Math.max(0, Date.now() - Date.parse(prev.created_at)) / 1000) });
  } else if (status === "connecting" && prev.status === "connected" && provider === "whatsapp") {
    recordEvent(user, "wa_reconnect", { reason: "connection_lost" });
  }
}

export async function loadCredentials<T>(accountId: string): Promise<T> {
  const row = must(
    await db.from("account_credentials").select("ciphertext").eq("account_id", accountId).maybeSingle(),
    "load credentials",
  );
  if (!row) throw Object.assign(new Error("No credentials stored"), { code: "NO_CREDENTIALS" });
  return decryptJson<T>(row.ciphertext, env.encryptionKey);
}

export async function getSyncState(accountId: string, scope: string) {
  return must(
    await db.from("sync_state").select("*").eq("account_id", accountId).eq("scope", scope).maybeSingle(),
    "load sync state",
  );
}

export async function saveSyncState(accountId: string, scope: string, patch: { uid_validity?: number; last_uid?: number; history_id?: string | null; sync_token?: string | null }) {
  must(
    await db.from("sync_state").upsert({ account_id: accountId, scope, ...patch }, { onConflict: "account_id,scope" }),
    "save sync state",
  );
}

/** The most rows the API returns for one request, whatever limit is asked for. */
export const PAGE_ROWS = 1000;

/**
 * Every row of a query, a page at a time, up to `limit`. The query must be ordered (for example by id)
 * so pages neither overlap nor skip rows. Throws like must() on an error.
 */
export async function allRows<T>(
  page: (from: number, to: number) => PromiseLike<PostgrestSingleResponse<T[]>>,
  what: string,
  limit = Infinity,
): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; rows.length < limit; from += PAGE_ROWS) {
    const batch = must(await page(from, from + PAGE_ROWS - 1), what);
    rows.push(...batch);
    if (batch.length < PAGE_ROWS) break;
  }
  return rows.length > limit ? rows.slice(0, limit) : rows;
}

/** Records that an account is still syncing, for the "Last synced" line in the app. Never throws. */
export async function touchAccount(accountId: string) {
  await db
    .from("accounts")
    .update({ last_synced_at: new Date().toISOString() })
    .eq("id", accountId)
    .then(() => undefined, () => undefined);
}

/**
 * Retries a write that records something already done elsewhere (an email sent, an event created), so
 * a database hiccup does not turn it into a failure that invites doing it twice. Returns false when every
 * attempt failed; the caller then marks it as "may have gone out".
 */
export async function retryWrite(write: () => PromiseLike<{ error: unknown }>, attempts = 3): Promise<boolean> {
  for (let attempt = 0; attempt < attempts; attempt++) {
    const { error } = await write();
    if (!error) return true;
    if (attempt < attempts - 1) await new Promise((resolve) => setTimeout(resolve, 1_000 * (attempt + 1)));
  }
  return false;
}
