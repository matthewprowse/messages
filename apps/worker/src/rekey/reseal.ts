// Re-sealing one user's values from an old data key to the new one, for the re-key job (job.ts). Pure: keys and values
// in, values out; no database or storage.
//
// It is deliberately generic rather than a list of columns. A row's text-like columns are walked (JSON and arrays too)
// and every string that is sealed under the user's key is handled by its prefix:
//   "e1:", "e2:"     a field: tried with the field that opened the last value at this place first, then every field in
//                    fields.ts (AES-GCM refuses a wrong field, so trying is safe), and sealed again under the same field.
//                    A bound value ("e2:") keeps the place and row it names. With `bind` (SEAL_BOUND_FIELDS on), a legacy
//                    "e1:" value is sealed again as "e2:" bound to its owner, "<table>.<column>" and, for the tables that
//                    bind rows (packages/crypto/src/places.ts), its row: even one already under the current key. So a
//                    pass doubles as the move from e1 to e2, and a rotation is only clean once none is left.
//   "v2:"            a sign-in or handoff under the credential key, with the additional data its table says (contextsFor).
//   "ZTFiOgD/S0..."  a sealed file kept as base64 in a column (message_embeddings.embedding_data): the base64 of the
//                    "e1b:" header, opened and sealed again like a stored file (kept in the legacy format: its reader,
//                    apps/ai/ai/similar.py, names no place).
// A stored file (job.ts) is opened at its place ("<bucket>/<path>") and, with `bind`, sealed again as "e2b:" bound to it.
// A value already under the current key is left alone, so a pass can be stopped and run again. A value no key opens is
// counted as unreadable and left as it is: it was unreadable before the job too.

import { BOUND_PREFIX, decryptBytes, decryptField, encryptAt, encryptBytes, encryptBytesAt, encryptField, isBoundBytes, isSealedBytes, placeOf, PREFIX, type Place, type UserKeys } from "@messages/crypto";
import { FIELD } from "@messages/crypto/fields";
import { boundRowOf } from "@messages/crypto/places";
import { CREDENTIAL_PREFIX, handoffContext, openBound, sealBound } from "@messages/crypto/wrap";

/** One data key's derived keys, without older ones: a value must open with exactly this key to count as under it. */
export interface KeyPair {
  keys: UserKeys;
  credential: Uint8Array<ArrayBuffer>;
}

/** The keys a pass works with: the current key (everything ends up under it) and the ones it moves values away from. */
export interface RekeyRing {
  current: KeyPair;
  olds: KeyPair[];
}

/** The base64 of the sealed-file header ("e1b:" 00 FF "KN"): the first 10 characters are the same for every sealed file. */
export const SEALED_B64_PREFIX = "ZTFiOgD/S0";

/** What happened to the values a call looked at. */
export interface Tally {
  moved: number;
  current: number;
  unreadable: number;
}

export const emptyTally = (): Tally => ({ moved: 0, current: 0, unreadable: 0 });

export function addTally(into: Tally, from: Tally): Tally {
  into.moved += from.moved;
  into.current += from.current;
  into.unreadable += from.unreadable;
  return into;
}

const ALL_FIELDS: string[] = [...new Set(Object.values(FIELD) as string[])];

/**
 * Remembers which field opened a value at each place (`table.column.path`), so the next value there is tried with it first
 * and a column costs about one decryption a value, not one per field.
 */
export class FieldMemo {
  private seen = new Map<string, string>();
  order(place: string): string[] {
    const hit = this.seen.get(place);
    return hit ? [hit, ...ALL_FIELDS.filter((f) => f !== hit)] : ALL_FIELDS;
  }
  note(place: string, field: string) {
    this.seen.set(place, field);
  }
}

type Outcome = { value: string; state: "moved" | "current" | "unreadable" };

async function opens<T>(fn: () => Promise<T>): Promise<T | undefined> {
  try {
    return await fn();
  } catch {
    return undefined;
  }
}

/**
 * A sealed field ("e1:", "e2:") under the current key. `bindTo` is where a legacy value is bound when it is sealed again
 * (null: it stays legacy); a bound value keeps its own place and row.
 */
export async function resealField(ring: RekeyRing, memo: FieldMemo, place: string, value: string, bindTo: Place | null = null): Promise<Outcome> {
  const bound = value.startsWith(BOUND_PREFIX);
  const sealAgain = (field: string, plain: string) => {
    const at = bound ? placeOf(value) : bindTo;
    return at ? encryptAt(ring.current.keys, field, at, plain) : encryptField(ring.current.keys, field, plain);
  };
  for (const field of memo.order(place)) {
    const now = await opens(() => decryptField(ring.current.keys, field, value));
    if (now !== undefined) {
      memo.note(place, field);
      // Under the current key: only a legacy value that is to be bound moves.
      return bound || !bindTo ? { value, state: "current" } : { value: await sealAgain(field, now), state: "moved" };
    }
    for (const old of ring.olds) {
      const plain = await opens(() => decryptField(old.keys, field, value));
      if (plain === undefined) continue;
      memo.note(place, field);
      return { value: await sealAgain(field, plain), state: "moved" };
    }
  }
  return { value, state: "unreadable" };
}

/**
 * A sealed file's bytes under the current key; `fields` are tried first (the memo's order for its place). `where` is the
 * file's place ("<bucket>/<path>"): a bound file opens only there, and with `bind` a legacy one is sealed again bound to it.
 */
export async function resealBytes(ring: RekeyRing, fields: string[], sealed: Uint8Array<ArrayBuffer>, where?: string, bind = false): Promise<{ bytes: Uint8Array<ArrayBuffer>; state: Outcome["state"]; field?: string }> {
  if (!isSealedBytes(sealed)) return { bytes: sealed, state: "current" };
  const bound = isBoundBytes(sealed);
  const toBound = !!where && (bound || bind);
  const sealAgain = (field: string, plain: Uint8Array<ArrayBuffer>) => (toBound ? encryptBytesAt(ring.current.keys, field, where!, plain) : encryptBytes(ring.current.keys, field, plain));
  for (const field of fields) {
    const now = await opens(() => decryptBytes(ring.current.keys, field, sealed, where));
    if (now !== undefined) return bound || !toBound ? { bytes: sealed, state: "current", field } : { bytes: await sealAgain(field, now), state: "moved", field };
    for (const old of ring.olds) {
      const plain = await opens(() => decryptBytes(old.keys, field, sealed, where));
      if (plain === undefined) continue;
      return { bytes: await sealAgain(field, plain), state: "moved", field };
    }
  }
  return { bytes: sealed, state: "unreadable" };
}

/** A sealed file kept in a column as base64. */
async function resealBase64(ring: RekeyRing, memo: FieldMemo, place: string, value: string): Promise<Outcome> {
  const raw = Uint8Array.from(Buffer.from(value, "base64"));
  const out = await resealBytes(ring, memo.order(place), raw);
  if (out.field) memo.note(place, out.field);
  return { value: out.state === "moved" ? Buffer.from(out.bytes).toString("base64") : value, state: out.state };
}

/** A "v2:" value under the credential key, for one of the additional data its place may use. */
export async function resealBoundValue(ring: RekeyRing, contexts: string[], value: string): Promise<Outcome> {
  for (const context of contexts) {
    if ((await opens(() => openBound(ring.current.credential, context, value))) !== undefined) return { value, state: "current" };
    for (const old of ring.olds) {
      const plain = await opens(() => openBound(old.credential, context, value));
      if (plain === undefined) continue;
      return { value: await sealBound(ring.current.credential, context, plain), state: "moved" };
    }
  }
  return { value, state: "unreadable" };
}

/**
 * The additional data a "v2:" value in this table may be bound to: an account's sign-in or session ("account:<id>"), or
 * a handoff stored in that row's column (handoffContext). Empty when the table holds none.
 */
export function contextsFor(table: string, column: string, key: Record<string, unknown>, row: Record<string, unknown>): string[] {
  const account = (row.account_id ?? key.account_id) as string | undefined;
  if (table === "icloud_setups" && typeof key.id === "string") return [handoffContext(table, column, key.id)];
  if (table === "instagram_sign_ins" && typeof account === "string") return [handoffContext(table, column, account)];
  return typeof account === "string" ? [`account:${account}`] : [];
}

/** Whether a string is sealed in a way this job handles. */
export const looksSealed = (v: string) => v.startsWith(PREFIX) || v.startsWith(BOUND_PREFIX) || v.startsWith(CREDENTIAL_PREFIX) || v.startsWith(SEALED_B64_PREFIX);

/**
 * The re-sealed version of one column's value (text, an array or JSON), and what happened to each sealed string in it.
 * The value is returned unchanged (the same object) when nothing moved.
 */
export async function resealValue(ring: RekeyRing, memo: FieldMemo, place: string, value: unknown, contexts: string[], bindTo: Place | null = null): Promise<{ value: unknown; tally: Tally }> {
  const tally = emptyTally();
  const walk = async (node: unknown, path: string): Promise<unknown> => {
    if (typeof node === "string") {
      if (!looksSealed(node)) return node;
      const out = node.startsWith(PREFIX) || node.startsWith(BOUND_PREFIX)
        ? await resealField(ring, memo, path, node, bindTo)
        : node.startsWith(CREDENTIAL_PREFIX)
          ? await resealBoundValue(ring, contexts, node)
          : await resealBase64(ring, memo, path, node);
      tally[out.state]++;
      return out.value;
    }
    if (Array.isArray(node)) {
      const next = [];
      let changed = false;
      for (const item of node) {
        const v = await walk(item, `${path}[]`);
        changed ||= v !== item;
        next.push(v);
      }
      return changed ? next : node;
    }
    if (node && typeof node === "object") {
      const next: Record<string, unknown> = {};
      let changed = false;
      for (const [k, item] of Object.entries(node)) {
        const v = await walk(item, `${path}.${k}`);
        changed ||= v !== item;
        next[k] = v;
      }
      return changed ? next : node;
    }
    return node;
  };
  return { value: await walk(value, place), tally };
}

/** A guarded write for rekey_write: the new values and the old ones they replace. */
export interface RekeyWrite {
  key: Record<string, unknown>;
  expect: Record<string, unknown>;
  set: Record<string, unknown>;
}

/** How a pass binds legacy values: off, or on with the row's id columns (rekey_page's "ids") to name the row by. */
export interface BindOptions {
  bind: boolean;
  ids?: Record<string, unknown>;
}

/**
 * One row's re-sealed columns as a write, or null when every value is already under the current key (or unreadable) and,
 * with `opts.bind`, already bound. A legacy value is bound to "<table>.<column>" and the row boundRowOf names.
 */
export async function resealRow(ring: RekeyRing, memo: FieldMemo, table: string, key: Record<string, unknown>, row: Record<string, unknown>, opts: BindOptions = { bind: false }): Promise<{ write: RekeyWrite | null; tally: Tally }> {
  const tally = emptyTally();
  const write: RekeyWrite = { key, expect: {}, set: {} };
  const boundRow = opts.bind ? boundRowOf(table, { ...opts.ids, ...row, ...key }) : undefined;
  for (const [column, value] of Object.entries(row)) {
    if (column in key) continue;
    const bindTo = opts.bind ? { place: `${table}.${column}`, row: boundRow ?? null } : null;
    const out = await resealValue(ring, memo, `${table}.${column}`, value, contextsFor(table, column, key, row), bindTo);
    addTally(tally, out.tally);
    if (out.value !== value) {
      write.expect[column] = value;
      write.set[column] = out.value;
    }
  }
  return { write: Object.keys(write.set).length ? write : null, tally };
}
