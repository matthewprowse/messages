// Short-lived secrets handed from one request to the next, sealed under the user's own key (docs/security-audit,
// M6). Pure: the caller fetches the keys (accounts.ts). Two kinds:
//
//   Cookies (the 10 minute OAuth sign-ins): "h2:<user id>.<base64(iv | tag | ciphertext)>", AES-256-GCM under the user's
//   credential key (packages/crypto/src/wrap.ts, sealBound) with "handoff:<purpose>:<user id>" as additional data. The
//   callback has no session, so the user id rides in the clear to say whose key opens it; the sealed value must carry the
//   same id. The old "h1:" cookies (the static ENCRYPTION_KEY) are no longer read: one started before the release reads
//   as expired and the person starts again, which keeps the static key out of the web app.
//
//   Rows (a sign-in code typed in the app, the iCloud setup's sign-in and the password it made): "v2:" under the same
//   key with handoffContext ("handoff:<table>.<column>:<row id>"), so a value opens only in the column and row it was
//   written for. The AI worker reads and writes the same (apps/ai/ai/connectors/instagram/sealing.py, seal_handoff).

import { CREDENTIAL_PREFIX, handoffContext, openBound, sealBound } from "@messages/crypto/wrap";

/** What a sealed cookie is for. Part of its additional data, so one sealed for one flow cannot be opened by another. */
export type HandoffPurpose = "google_connect" | "microsoft_connect" | "zoom_connect" | "instagram_connect";

/** The table columns a handoff is stored in. */
export type HandoffColumn = { table: "icloud_setups"; column: "sign_in" | "result" | "code" } | { table: "instagram_sign_ins"; column: "code" };

const USER_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const COOKIE = /^h2:([0-9a-f-]{36})\.([A-Za-z0-9+/=]+)$/;

const cookieContext = (purpose: HandoffPurpose, userId: string) => `handoff:${purpose}:${userId.toLowerCase()}`;

const failed = (message: string, code: string) => Object.assign(new Error(message), { code });

/** Seals a cookie handoff for this purpose under the user's current credential key. */
export async function sealCookie(credKey: Uint8Array<ArrayBuffer>, value: { userId: string }, purpose: HandoffPurpose): Promise<string> {
  if (!USER_ID.test(value.userId)) throw failed("A handoff needs the user's id.", "handoff_no_user");
  const user = value.userId.toLowerCase();
  const sealed = await sealBound(credKey, cookieContext(purpose, user), JSON.stringify(value));
  return `h2:${user}.${sealed.slice(CREDENTIAL_PREFIX.length)}`;
}

/** The user a cookie handoff names, read before opening it to know whose keys open it. Null when it is not one. */
export function cookieUser(payload: string): string | null {
  const match = COOKIE.exec(payload);
  return match && USER_ID.test(match[1]) ? match[1].toLowerCase() : null;
}

/**
 * Opens a cookie handoff sealed for this purpose with any of the user's credential keys. Throws when it was sealed for
 * another purpose or user, was changed, or is in an older format.
 */
export async function openCookie<T extends { userId: string }>(credKeys: Uint8Array<ArrayBuffer>[], payload: string, purpose: HandoffPurpose): Promise<T> {
  const match = COOKIE.exec(payload);
  const user = cookieUser(payload);
  if (!match || !user) throw failed("Unknown handoff format.", "handoff_format");
  const value = JSON.parse(await openBound(credKeys, cookieContext(purpose, user), CREDENTIAL_PREFIX + match[2])) as T;
  if (typeof value?.userId !== "string" || value.userId.toLowerCase() !== user) throw failed("Handoff user mismatch.", "handoff_user");
  return value;
}

/** Seals a value to store in one column of one row, under the user's current credential key. */
export async function sealRowHandoff(credKey: Uint8Array<ArrayBuffer>, where: HandoffColumn, rowId: string, value: unknown): Promise<string> {
  return sealBound(credKey, handoffContext(where.table, where.column, rowId), JSON.stringify(value));
}

/**
 * Opens a value stored by sealRowHandoff (or the AI worker's seal_handoff) in this column of this row. A "v1:" value
 * from before per-user handoffs goes to `legacy` (the old static key, which throws once that key is retired).
 */
export async function openRowHandoff<T>(credKeys: () => Promise<Uint8Array<ArrayBuffer>[]>, legacy: (payload: string) => T, where: HandoffColumn, rowId: string, payload: string): Promise<T> {
  if (payload.startsWith(CREDENTIAL_PREFIX)) return JSON.parse(await openBound(await credKeys(), handoffContext(where.table, where.column, rowId), payload)) as T;
  if (payload.startsWith("v1:")) return legacy(payload);
  throw failed("Unknown handoff format.", "handoff_format");
}
