"use client";

import { decryptField, deriveUserKeys, encryptField, isCiphertext, type UserKeys } from "@messages/crypto";
import type { Field } from "@messages/crypto/fields";
import { supabase } from "./supabase";

// The signed-in user's keys, fetched once from /api/keys and held in memory as WebCrypto keys that cannot
// be exported. Nothing is written to storage: signing out or closing the tab drops them.

let keys: Promise<UserKeys> | null = null;
let keysFor: string | null = null;

/** The user's keys, fetching them on first use. Rejects when signed out or the key service is down. */
export function userKeys(): Promise<UserKeys> {
  return (keys ??= fetchKeys());
}

async function fetchKeys(): Promise<UserKeys> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) { keys = null; throw new Error("Sign in first."); }
  keysFor = data.session!.user.id;
  const res = await fetch("/api/keys", { method: "POST", headers: { Authorization: `Bearer ${token}` }, cache: "no-store" });
  if (!res.ok) { keys = null; throw new Error("Could not open your messages."); }
  const { key } = (await res.json()) as { key: string };
  const raw = Uint8Array.from(atob(key), (c) => c.charCodeAt(0));
  const derived = await deriveUserKeys(raw);
  raw.fill(0);
  return derived;
}

// A different user signing in, or signing out, drops the keys held for the last one.
supabase.auth.onAuthStateChange((_event, session) => {
  if (!session || session.user.id !== keysFor) { keys = null; keysFor = null; }
});

/**
 * Opens one stored value: encrypted text is decrypted, anything else (older plaintext, null) comes back as
 * it is, so rows written before and after encryption read the same way. A value that cannot be opened reads
 * as an empty string rather than breaking the screen.
 */
export async function open(field: Field, value: string | null | undefined): Promise<string | null> {
  if (value == null || !isCiphertext(value)) return value ?? null;
  try {
    return await decryptField(await userKeys(), field, value);
  } catch {
    return "";
  }
}

// Switched on with the workers (ENCRYPT_CONTENT there), so new text is written encrypted everywhere at once.
const sealing = process.env.NEXT_PUBLIC_ENCRYPT_CONTENT === "true";

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
