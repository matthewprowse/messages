// Saving iCloud accounts, shared by the two ways to connect: a pasted app-specific password (/api/connect/icloud) and the
// one Apple ID sign-in that makes the password for the person (/api/connect/icloud-signin). Mail and Calendar are
// checked with iCloud before they are saved; Reminders is handed to the iCloud connector in the AI worker to sign in.
// Nothing here logs a password or an address.

import { ImapFlow } from "imapflow";
import { accountForSignIn } from "@/lib/icloud-mail";
import { ensureProfile, openAccountJson, saveAccountRow, saveCredentials, sealAccountJson } from "@/lib/server/accounts";
import { admin } from "@/lib/server/request";

const ICLOUD_IMAP = { host: "imap.mail.me.com", port: 993, secure: true } as const;
const CALDAV = "https://caldav.icloud.com/";

export async function checkMail(user: string, pass: string): Promise<"ok" | "rejected" | "unreachable"> {
  const probe = new ImapFlow({ ...ICLOUD_IMAP, auth: { user, pass }, logger: false });
  try {
    await probe.connect();
    await probe.logout();
    return "ok";
  } catch (err) {
    return (err as { authenticationFailed?: boolean }).authenticationFailed ? "rejected" : "unreachable";
  }
}

/** Whether the same sign-in opens iCloud Calendar: one PROPFIND, 207 when it does. */
export async function checkCalendar(user: string, pass: string): Promise<boolean> {
  try {
    const response = await fetch(CALDAV, {
      method: "PROPFIND",
      headers: { authorization: `Basic ${Buffer.from(`${user}:${pass}`).toString("base64")}`, depth: "0", "content-type": "application/xml" },
      body: '<?xml version="1.0"?><d:propfind xmlns:d="DAV:"><d:prop><d:current-user-principal/></d:prop></d:propfind>',
      signal: AbortSignal.timeout(15_000),
    });
    return response.status === 207;
  } catch {
    return false;
  }
}

/** The person's iCloud Mail account that signs in as `username` (the oldest, if several do), with its saved aliases. */
async function mailAccountSignedInAs(userId: string, username: string): Promise<{ id: string; aliases: string[] } | null> {
  if (!admin) throw new Error("Supabase is not set up.");
  const { data: rows, error } = await admin.from("accounts").select("id, created_at").eq("user_id", userId).eq("provider", "icloud");
  if (error) throw error;
  if (!rows.length) return null;
  const { data: creds, error: credsError } = await admin.from("account_credentials").select("account_id, ciphertext").in("account_id", rows.map((r) => r.id));
  if (credsError) throw credsError;
  const accounts = await Promise.all(rows.map(async (row) => {
    const sealed = creds.find((c) => c.account_id === row.id)?.ciphertext;
    // A sign-in that will not open is treated as no match: that account is left alone and a new one may be made.
    const saved = sealed ? await openAccountJson<{ username?: string; aliases?: string[] }>(row.id, sealed, userId).catch(() => null) : null;
    return { id: row.id, createdAt: row.created_at, username: saved?.username ?? null, aliases: saved?.aliases ?? [] };
  }));
  const found = accountForSignIn(accounts, username);
  return found && { id: found.id, aliases: found.aliases };
}

/** Saves iCloud Mail and, when wanted, iCloud Calendar on one app-specific password, already checked with iCloud. */
export async function saveMailAndCalendar(userId: string, opts: { username: string; address: string; password: string; mail: boolean; calendar: boolean }) {
  await ensureProfile(userId);
  const { username, address, password } = opts;
  if (opts.mail) {
    // A new password for a mailbox already connected reconnects that account, keeping its address and aliases; the
    // address typed only names a first connect. Matching by address alone made a second copy of the same mailbox.
    const same = await mailAccountSignedInAs(userId, username);
    if (same && admin) {
      const { error } = await admin.from("accounts").update({ label: "iCloud+ Mail", status: "connecting", status_detail: null }).eq("id", same.id);
      if (error) throw error;
      await saveCredentials(same.id, { username, password, aliases: same.aliases }, userId);
    } else {
      await saveCredentials(await saveAccountRow(userId, "icloud", "iCloud+ Mail", address), { username, password, aliases: [] });
    }
  }
  if (opts.calendar) await saveCredentials(await saveAccountRow(userId, "icloud_calendar", "iCloud Calendar", username, { onePerUser: true }), { username, password });
}

/**
 * Starts iCloud Reminders: saves the Apple ID and password (kind "web") for the connector to sign in with. A session
 * saved by an earlier sign-in for the same Apple ID is kept, so Apple may not ask for a code again; a trust token from
 * the sign-in that just made the app-specific password does the same for a first connect.
 */
export async function startReminders(userId: string, appleId: string, password: string, trustToken?: string | null): Promise<string> {
  if (!admin) throw new Error("Supabase is not set up.");
  await ensureProfile(userId);
  // One Reminders account per person: signing in with another Apple ID takes over the account they have.
  const accountId = await saveAccountRow(userId, "icloud_reminders", "iCloud Reminders", appleId, { onePerUser: true });
  // A sign-in step left over from an earlier try is cleared, so the app never shows a stale one.
  await admin.from("instagram_sign_ins").delete().eq("account_id", accountId);
  const { error: statusError } = await admin.from("accounts").update({ status_detail: "Signing in to iCloud." }).eq("id", accountId);
  if (statusError) throw statusError;

  const { data: existing } = await admin.from("account_credentials").select("refreshed").eq("account_id", accountId).maybeSingle();
  let refreshed = existing?.refreshed ?? null;
  if (refreshed) {
    try {
      // A session saved for another Apple ID is no use to this one.
      if ((await openAccountJson<{ appleId?: string }>(accountId, refreshed)).appleId?.toLowerCase() !== appleId) refreshed = null;
    } catch {
      refreshed = null;
    }
  }
  // pyicloud's session file holds the trust token; the connector writes it back as it was saved (session.SessionDir).
  if (!refreshed && trustToken) refreshed = await sealAccountJson(accountId, { appleId, session: { session: JSON.stringify({ trust_token: trustToken }) } });
  const { error } = await admin
    .from("account_credentials")
    .upsert({ account_id: accountId, ciphertext: await sealAccountJson(accountId, { kind: "web", appleId, password }), refreshed, updated_at: new Date().toISOString() }, { onConflict: "account_id" });
  if (error) throw error;
  return accountId;
}
