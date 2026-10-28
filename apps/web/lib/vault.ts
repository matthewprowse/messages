"use client";

// The signed-in user's keys, fetched once from /api/keys and held in memory as WebCrypto keys that cannot
// be exported. Nothing is written to storage: signing out or closing the tab drops them. A user in a team
// gets the team's keys in the same reply, only while they are an active member, so a removed member's next
// load has none.

import { flagOn } from "@messages/crypto/flags";
import { decryptAny, deriveTeamKeys, deriveUserKeys, encryptField, isCiphertext, type TeamKeys, type UserKeys } from "@messages/crypto";
import type { Field } from "@messages/crypto/fields";
import { supabase } from "./supabase";

// teamOlds: the team's earlier key versions, newest first. A value sealed before the team's last rotation (a member
// was removed) opens with one of them until the worker has re-sealed it under the current key.
type Held = { user: UserKeys; team: TeamKeys | null; teamOlds: TeamKeys[] };

let keys: Promise<Held> | null = null;
let keysFor: string | null = null;

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

function held(): Promise<Held> {
  if (!keys) {
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
  const { key, team } = (await res.json()) as {
    key: string;
    team?: { workspaceId: string; key: string; version?: number; versions?: { version: number; key: string }[]; indexKey?: string } | null;
  };
  const raw = Uint8Array.from(atob(key), (c) => c.charCodeAt(0));
  const derived = await deriveUserKeys(raw);
  raw.fill(0);
  let derivedTeam: TeamKeys | null = null;
  const teamOlds: TeamKeys[] = [];
  if (team) {
    // Each version seals with its own key, but the blind index always comes from the first version's (indexKey).
    const bytes = (b64: string) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const root = team.indexKey ? await deriveTeamKeys(bytes(team.indexKey)) : null;
    const derive = async (b64: string): Promise<TeamKeys> => {
      const raw = bytes(b64);
      const t = await deriveTeamKeys(raw);
      raw.fill(0);
      return root ? { ...t, index: root.index } : t;
    };
    derivedTeam = await derive(team.key);
    for (const v of team.versions ?? []) if (v.version !== team.version) teamOlds.push(await derive(v.key));
  }
  return { user: derived, team: derivedTeam, teamOlds };
}

// A different user signing in, or signing out, drops the keys held for the last one.
supabase.auth.onAuthStateChange((_event, session) => {
  if (!session || session.user.id !== keysFor) { keys = null; keysFor = null; }
});

/**
 * Opens one stored value: encrypted text is decrypted, anything else (older plaintext, null) comes back as
 * it is, so rows written before and after encryption read the same way. A user's value (e1:) opens with
 * their keys, a team's (t1:) with the team's. A value that cannot be opened (a t1: value without team keys
 * included) reads as an empty string rather than breaking the screen.
 */
export async function open(field: Field, value: string | null | undefined): Promise<string | null> {
  if (value == null || !isCiphertext(value)) return value ?? null;
  try {
    const h = await held();
    try {
      return await decryptAny(h, field, value);
    } catch (err) {
      for (const team of h.teamOlds) {
        try {
          return await decryptAny({ team }, field, value);
        } catch {
          // another version
        }
      }
      throw err;
    }
  } catch {
    return "";
  }
}

// On unless NEXT_PUBLIC_ENCRYPT_CONTENT is "false" (the workers read ENCRYPT_CONTENT), so new text is written encrypted everywhere at once.
const sealing = flagOn(process.env.NEXT_PUBLIC_ENCRYPT_CONTENT);

/** Text to store: encrypted when sealing is on, as it is otherwise. null stays null. */
export async function seal(field: Field, value: string): Promise<string>;
export async function seal(field: Field, value: string | null): Promise<string | null>;
export async function seal(field: Field, value: string | null): Promise<string | null> {
  if (value == null || !sealing) return value;
  return encryptField(await userKeys(), field, value);
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
