"use client";

// The signed-in user's keys, fetched once from /api/keys and held in memory as WebCrypto keys that cannot
// be exported. Nothing is written to storage: signing out or closing the tab drops them. A user in a team
// gets the team's keys in the same reply, only while they are an active member, so a removed member's next
// load has none.
//
// The keys are fetched again once they are KEY_REFRESH_MS old, at the next use: a rotation of the user's key (or a
// team's) is picked up within that time, so this tab never seals with a key the re-seal job has moved away from for
// longer than the job waits (apps/worker/src/rekey). A refresh that fails keeps the keys held.
//
// Keys are derived for their owner (this user, the team's workspace), so values bound to their owner and place ("e2:",
// packages/crypto/src/bound.ts) open. seal writes that format, at the place its caller names, once
// NEXT_PUBLIC_SEAL_BOUND_FIELDS is on, and the legacy "e1:" until then. A value that will not open reads as UNREADABLE.

import { flagOn, flagTrue } from "@messages/crypto/flags";
import { decryptAny, deriveTeamKeys, deriveUserKeyring, encryptAt, encryptBytes, encryptBytesAt, encryptField, importIndexKey, isCiphertext, type Place, type TeamKeys, type UserKeys } from "@messages/crypto";
import { BROWSER_KEY_HOLD_MS } from "@messages/crypto/flags";
import type { Field } from "@messages/crypto/fields";
import { supabase } from "./supabase";

// teamOlds: the team's earlier key versions, newest first. A value sealed before the team's last rotation (a member
// was removed) opens with one of them until the worker has re-sealed it under the current key.
type Held = { user: UserKeys; team: TeamKeys | null; teamOlds: TeamKeys[] };

let keys: Promise<Held> | null = null;
let keysFor: string | null = null;
let fetchedAt = 0;

/** How old held keys may get before the next use fetches them again. The re-seal job waits longer than this. */
const KEY_REFRESH_MS = BROWSER_KEY_HOLD_MS;

/** The user's keys, fetching them on first use. Rejects when signed out or the key service is down. */
export async function userKeys(): Promise<UserKeys> {
  return (await held()).user;
}

/** The team's keys, or null when the user has no active team. */
export async function teamKeys(): Promise<TeamKeys | null> {
  return (await held()).team;
}

/** The team's keys, current version first and then the older ones, or an empty list without an active team. */
export async function teamKeyRing(): Promise<TeamKeys[]> {
  const h = await held();
  return h.team ? [h.team, ...h.teamOlds] : [];
}

/**
 * Starts fetching the keys if none are held or on the way, so the request runs beside the first queries instead of
 * after them. Never rejects: a failure here clears the attempt (see held), and the open() that needs the keys asks
 * again and rejects as usual.
 */
export function warmKeys(): void {
  held().catch(() => undefined);
}

function held(): Promise<Held> {
  if (keys && Date.now() - fetchedAt > KEY_REFRESH_MS) {
    const stale = keys;
    const fresh = fetchKeys();
    fetchedAt = Date.now();
    // A refresh that fails (offline, a blip) keeps what is held; signing out still drops it (onAuthStateChange).
    keys = fresh.catch(() => stale);
    return keys;
  }
  if (!keys) {
    fetchedAt = Date.now();
    const pending = fetchKeys();
    keys = pending;
    // Any failure (signed out, network, a bad reply) lets the next call try again, but only clears this
    // attempt: a newer fetch started after a sign-in change is left alone.
    pending.catch(() => { if (keys === pending) { keys = null; keysFor = null; } });
  }
  return keys;
}

async function fetchKeys(): Promise<Held> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error("Sign in first.");
  keysFor = data.session!.user.id;
  const res = await fetch("/api/keys", { method: "POST", headers: { Authorization: `Bearer ${token}` }, cache: "no-store" });
  if (!res.ok) throw new Error("Could not open your messages.");
  const userId = data.session!.user.id;
  const { key, older, indexKey, team } = (await res.json()) as {
    key: string;
    older?: string[];
    indexKey?: string | null;
    team?: { workspaceId: string; key: string; version?: number; versions?: { version: number; key: string }[]; indexKey?: string | null; indexHmacKey?: string | null } | null;
  };
  const bytes = (b64: string) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  const raw = bytes(key);
  const olderRaw = (older ?? []).map(bytes);
  const indexRaw = indexKey ? bytes(indexKey) : null;
  const derived = await deriveUserKeyring(raw, olderRaw, indexRaw, userId);
  for (const k of [raw, ...olderRaw, ...(indexRaw ? [indexRaw] : [])]) k.fill(0);
  let derivedTeam: TeamKeys | null = null;
  const teamOlds: TeamKeys[] = [];
  if (team) {
    // Each version seals with its own key, but the blind index always comes from the first version's: the index key
    // itself when the server hands it out (indexHmacKey), else derived from the first data key (indexKey).
    const root = team.indexHmacKey ? { index: await importIndexKey(bytes(team.indexHmacKey)) } : team.indexKey ? await deriveTeamKeys(bytes(team.indexKey)) : null;
    const derive = async (b64: string): Promise<TeamKeys> => {
      const raw = bytes(b64);
      const t = await deriveTeamKeys(raw, team.workspaceId);
      raw.fill(0);
      return root ? { ...t, index: root.index } : t;
    };
    derivedTeam = await derive(team.key);
    for (const v of team.versions ?? []) if (v.version !== team.version) teamOlds.push(await derive(v.key));
  }
  return { user: derived, team: derivedTeam, teamOlds };
}

// A different user signing in, or signing out, drops the keys held for the last one. A fetch that has not yet read
// the session (keysFor still null) is kept: it reads whoever is signed in now, and dropping it would throw away the
// early fetch warmKeys started whenever the first auth event lands after it.
supabase.auth.onAuthStateChange((_event, session) => {
  if (!session || (keysFor !== null && session.user.id !== keysFor)) { keys = null; keysFor = null; }
});

/**
 * What a sealed value of prose that will not open reads as (altered, moved, or a team value without the team's keys), so
 * the screen says so instead of showing it blank. Never write it back: isUnreadable tells it apart.
 */
export const UNREADABLE = "Unreadable";

/**
 * Kinds that still read as "" when they will not open: JSON (no parser takes "Unreadable", and theirs fall back), and
 * addresses, domains and links, which code passes on (a reply's recipients, a link to open) and drops when empty.
 */
const EMPTY_WHEN_UNREADABLE = new Set<string>([
  "marks", "choices", "event_guests", "meeting_actions", "action", "bulk_read", "doc_card", "automation", "automation_run", "transcript",
  "address", "domain", "event_link", "event_file", "unsubscribe",
]);

/** Whether an opened value is the UNREADABLE marker rather than real text: callers that save text back skip it. */
export const isUnreadable = (value: string | null | undefined) => value === UNREADABLE;

/**
 * Opens one stored value: encrypted text is decrypted, anything else (older plaintext, null) comes back as
 * it is, so rows written before and after encryption read the same way. A user's value (e1:, e2:) opens with
 * their keys, a team's (t1:, t2:) with the team's. A value that cannot be opened (a team value without team keys
 * included) reads as UNREADABLE rather than breaking the screen; failing to fetch the keys rejects instead.
 */
export async function open(field: Field, value: string | null | undefined): Promise<string | null> {
  if (value == null || !isCiphertext(value)) return value ?? null;
  // A key request that fails rejects: the caller shows a load error or keeps what it had. Turning it into "" would
  // blank every sealed column at once with no sign anything went wrong.
  const h = await held();
  try {
    return await decryptAny(h, field, value);
  } catch {
    for (const team of h.teamOlds) {
      try {
        return await decryptAny({ team }, field, value);
      } catch {
        // another version
      }
    }
    return EMPTY_WHEN_UNREADABLE.has(field) ? "" : UNREADABLE;
  }
}

// On unless NEXT_PUBLIC_ENCRYPT_CONTENT is "false" (the workers read ENCRYPT_CONTENT), so new text is written encrypted everywhere at once.
const sealing = flagOn(process.env.NEXT_PUBLIC_ENCRYPT_CONTENT);
// Off unless "true" (the workers read SEAL_BOUND_FIELDS): bound values are written only once every reader can open them.
const sealingBound = flagTrue(process.env.NEXT_PUBLIC_SEAL_BOUND_FIELDS);

/**
 * One value sealed with the user's key: bound to its owner and `where` ("e2:") once NEXT_PUBLIC_SEAL_BOUND_FIELDS is on,
 * the legacy "e1:" until then. Without `where` a bound value names no place, which the workers' strict readers refuse.
 */
export async function sealWith(keys: UserKeys, field: Field, value: string, where?: Place): Promise<string> {
  return sealingBound ? encryptAt(keys, field, where ?? { place: "" }, value) : encryptField(keys, field, value);
}

/** A file's bytes sealed with the user's key, bound to `where` ("<bucket>/<path>") once bound values are on. */
export async function sealBytesWith(keys: UserKeys, field: Field, bytes: Uint8Array<ArrayBuffer>, where: string): Promise<Uint8Array<ArrayBuffer>> {
  return sealingBound ? encryptBytesAt(keys, field, where, bytes) : encryptBytes(keys, field, bytes);
}

/** Text to store at `where` (table, column and the row when known): encrypted when sealing is on, as it is otherwise. null stays null. */
export async function seal(field: Field, value: string, where?: Place): Promise<string>;
export async function seal(field: Field, value: string | null, where?: Place): Promise<string | null>;
export async function seal(field: Field, value: string | null, where?: Place): Promise<string | null> {
  if (value == null || !sealing) return value;
  return sealWith(await userKeys(), field, value, where);
}

/** A column and the kind of text it holds. */
export type TextColumn = readonly [column: string, field: Field];

/** Opens the named columns of each row in place and returns the rows. */
export async function openRows<T extends object>(rows: T[], columns: readonly TextColumn[]): Promise<T[]> {
  if (!rows.some((r) => columns.some(([c]) => isCiphertext((r as Record<string, unknown>)[c])))) return rows;
  await Promise.all(rows.flatMap((r) => columns.map(async ([c, field]) => {
    const row = r as Record<string, unknown>;
    if (isCiphertext(row[c])) row[c] = await open(field, row[c] as string);
  })));
  return rows;
}
