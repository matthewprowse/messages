// The re-key job for one user: makes a new data key ready, switches to it, re-seals every value and file sealed under
// the old one, and retires it (plan.ts says in what order and why). The database and storage come in through RekeyStore
// (store.ts for Supabase, a fake in the tests), so the whole run is tested without either. Run by the owner through
// scripts/rekey-user.ts; never started by the worker on its own.

import { deriveUserKeyring, newDataKey } from "@messages/crypto";
import { storageWhere } from "@messages/crypto/places";
import { deriveCredentialKey, indexKeyOf, userKeyringFor, zeroKeyring, type KeyStore, type KeyWrapper, type UserKeyRow } from "@messages/crypto/wrap";
import { nextStep, passIsClean, resumeCursor, type PassCursor, type RotationRow, type Step } from "./plan";
import { addTally, emptyTally, FieldMemo, resealBytes, resealRow, type KeyPair, type RekeyRing, type RekeyWrite, type Tally } from "./reseal";

/** Where a table's rows are found: by their own user_id, or by an account_id of the user's (the sign-in tables). */
export type Scope = "user" | "account";

/** One part of a pass: a table, or a storage bucket's "<user id>/" folder. */
export type Unit = { kind: "table"; name: string; scope: Scope } | { kind: "bucket"; name: string };

export const unitName = (u: Unit) => (u.kind === "bucket" ? `storage:${u.name}` : u.name);

/** What the job needs of the database and storage. */
export interface RekeyStore {
  keyRow(userId: string): Promise<UserKeyRow | null>;
  rotation(userId: string): Promise<(RotationRow & { cursor: unknown }) | null>;
  /** Stores the next key (and the index key, at a first rotation) only while the current key is still `current`, and records the phase. */
  prepare(userId: string, current: string, next: { wrapped_key: string; wrapped_by: string }, index: { wrapped_key: string; wrapped_by: string } | null): Promise<boolean>;
  /** Makes the next key current and the current one previous, only while the row is still `row`. */
  switchKeys(userId: string, row: UserKeyRow): Promise<boolean>;
  /** Clears the previous key, only while it is still `previous`, and marks the rotation done. */
  retire(userId: string, previous: string): Promise<boolean>;
  saveCursor(userId: string, cursor: PassCursor | Record<string, never>, totals?: { moved: number; unreadable: number }): Promise<void>;
  markClean(userId: string, passStarted: string): Promise<void>;
  /**
   * Up to `limit` of the user's rows after `after` (a primary key object) that hold something sealed. `ids` are the row's
   * uuid columns, which name the row a bound value belongs to (an outbox file's outbox_id); absent before 20261126100100.
   */
  page(table: string, scope: Scope, userId: string, after: unknown, limit: number): Promise<{ key: Record<string, unknown>; row: Record<string, unknown>; ids?: Record<string, unknown> }[]>;
  /** Guarded writes (rekey_write). Returns how many rows were written. */
  write(table: string, scope: Scope, userId: string, writes: RekeyWrite[]): Promise<number>;
  /** Every object path under the user's folder of a bucket. */
  listFiles(bucket: string, userId: string): Promise<string[]>;
  readFile(bucket: string, path: string): Promise<{ bytes: Uint8Array<ArrayBuffer>; contentType: string } | null>;
  writeFile(bucket: string, path: string, bytes: Uint8Array<ArrayBuffer>, contentType: string): Promise<void>;
}

export interface RekeyDeps {
  store: RekeyStore;
  wrappers: KeyWrapper[];
  units: Unit[];
  now?: () => number;
  /** Progress lines for the owner: ids, counts and codes only. */
  report?: (line: string) => void;
  /**
   * Seal legacy values again bound to their owner and place ("e2:", "e2b:"), even those under the current key: what
   * SEAL_BOUND_FIELDS says. Off: a pass only moves keys, as before bound values.
   */
  bind?: boolean;
}

export interface RekeyOptions {
  /** False: read and count, write nothing (the dry run). */
  apply: boolean;
  /** Start a rotation for a user who has none running. */
  start: boolean;
  acceptUnreadable?: boolean;
  turnoverMs?: number;
  graceMs?: number;
}

/** What a pass found, per unit. */
export type PassReport = { unit: string; tally: Tally; written: number; error?: string }[];

const PAGE = 100;

/** A user's keys as the job holds them: their keyring read without ever making a key. */
async function ringFor(deps: RekeyDeps, userId: string): Promise<RekeyRing> {
  const store: KeyStore = {
    read: (id) => deps.store.keyRow(id),
    insertIfAbsent: async () => { throw Object.assign(new Error("no data key"), { code: "no_key" }); },
  };
  const raw = await userKeyringFor(store, deps.wrappers, userId);
  try {
    // For their owner, so bound values ("e2:") open and are sealed for this user.
    const pair = async (k: Uint8Array<ArrayBuffer>): Promise<KeyPair> => ({ keys: await deriveUserKeyring(k, [], raw.indexKey, userId), credential: await deriveCredentialKey(k) });
    return { current: await pair(raw.current), olds: await Promise.all(raw.older.map(pair)) };
  } finally {
    zeroKeyring(raw);
  }
}

/**
 * One pass over every unit, from `cursor`. With `apply` it writes re-sealed values and saves the cursor after every page,
 * so a stopped run continues where it was; without, it only counts. A unit that fails (a table this database does not
 * have yet, a storage error) is reported and makes the pass unclean, so the old key is never retired past it.
 */
export async function runPass(deps: RekeyDeps, userId: string, ring: RekeyRing, cursor: PassCursor, apply: boolean): Promise<{ cursor: PassCursor; report: PassReport }> {
  const report: PassReport = [];
  const memo = new FieldMemo();
  for (const unit of deps.units) {
    const name = unitName(unit);
    if (cursor.done.includes(name)) continue;
    const entry = { unit: name, tally: emptyTally(), written: 0 } as PassReport[number];
    report.push(entry);
    try {
      if (unit.kind === "table") {
        let after = cursor.unit === name ? cursor.after : null;
        for (;;) {
          const rows = await deps.store.page(unit.name, unit.scope, userId, after, PAGE);
          const writes: RekeyWrite[] = [];
          for (const { key, row, ids } of rows) {
            const out = await resealRow(ring, memo, unit.name, key, row, { bind: !!deps.bind, ids });
            addTally(entry.tally, out.tally);
            cursor.unreadable += out.tally.unreadable;
            if (out.write) writes.push(out.write);
          }
          // Counted as moved when it needed moving, written or not: a row changed meanwhile is read again next pass.
          cursor.moved += writes.length;
          if (apply && writes.length) entry.written += await deps.store.write(unit.name, unit.scope, userId, writes);
          if (!rows.length || rows.length < PAGE) break;
          after = rows[rows.length - 1].key;
          if (apply) await deps.store.saveCursor(userId, { ...cursor, unit: name, after });
        }
      } else {
        for (const path of await deps.store.listFiles(unit.name, userId)) {
          const file = await deps.store.readFile(unit.name, path);
          if (!file) continue; // deleted meanwhile
          const out = await resealBytes(ring, memo.order(`storage:${unit.name}`), file.bytes, storageWhere(unit.name, path), !!deps.bind);
          if (out.field) memo.note(`storage:${unit.name}`, out.field);
          entry.tally[out.state]++;
          if (out.state === "unreadable") cursor.unreadable++;
          if (out.state !== "moved") continue;
          cursor.moved++;
          if (apply) {
            await deps.store.writeFile(unit.name, path, out.bytes, file.contentType);
            entry.written++;
          }
        }
      }
      cursor.done.push(name);
      cursor.unit = null;
      cursor.after = null;
      if (apply) await deps.store.saveCursor(userId, cursor);
    } catch (err) {
      entry.error = (err as { code?: string }).code ?? "failed";
      // Never clean, whatever is accepted: a unit that could not be read may still hold values under the old key.
      cursor.failed++;
      cursor.done.push(name);
      cursor.unit = null;
      cursor.after = null;
      if (apply) await deps.store.saveCursor(userId, cursor);
    }
  }
  return { cursor, report };
}

/**
 * One pass for one user that seals every legacy value again bound to its owner and place (scripts/fields-bind.ts), with
 * the keys they have now, outside any rotation: it never saves a cursor or touches user_key_rotations, so it can run
 * beside one. Idempotent: a value already bound is left alone, so running it again finishes what a stopped run left.
 */
export async function bindPass(deps: RekeyDeps, userId: string, apply: boolean): Promise<{ cursor: PassCursor; report: PassReport }> {
  const now = deps.now ?? Date.now;
  const ring = await ringFor(deps, userId);
  // The store as it is (a class's methods live on its prototype, so it is wrapped rather than spread), minus the cursor.
  const base = deps.store;
  const store: RekeyStore = Object.assign(Object.create(base) as RekeyStore, { saveCursor: async () => undefined, markClean: async () => undefined });
  return runPass({ ...deps, store, bind: true }, userId, ring, resumeCursor(null, now()), apply);
}

export type StepResult = { step: Step; changed: boolean; report?: PassReport; clean?: boolean };

/**
 * Does the next step for one user, if it is due, and says what it did. Without `apply` nothing is written: a user with a
 * rotation running, or one about to start, gets a counting pass so the owner sees what the re-seal would touch.
 */
export async function stepUser(deps: RekeyDeps, userId: string, opts: RekeyOptions): Promise<StepResult> {
  const now = deps.now ?? Date.now;
  const [key, rotation] = await Promise.all([deps.store.keyRow(userId), deps.store.rotation(userId)]);
  const step = nextStep(key, rotation, { now: now(), start: opts.start, turnoverMs: opts.turnoverMs, graceMs: opts.graceMs });
  if (!opts.apply) {
    if (step.kind === "blocked" && step.reason !== "not_started") return { step, changed: false };
    const ring = await ringFor(deps, userId);
    const { cursor, report } = await runPass(deps, userId, ring, resumeCursor(null, now()), false);
    return { step, changed: false, report, clean: passIsClean(cursor, !!opts.acceptUnreadable) };
  }
  switch (step.kind) {
    case "blocked":
    case "wait":
      return { step, changed: false };
    case "prepare": {
      const writer = deps.wrappers[0];
      const fresh = newDataKey();
      try {
        const next = { wrapped_key: await writer.wrap(fresh, userId), wrapped_by: writer.id };
        let index: { wrapped_key: string; wrapped_by: string } | null = null;
        if (!key!.index_wrapped_key) {
          // The index key the user's tokens were made with so far, kept so no blind index changes.
          const raw = await userKeyringFor({ read: async () => key, insertIfAbsent: async () => undefined }, deps.wrappers, userId);
          const indexKey = await indexKeyOf(raw);
          index = { wrapped_key: await writer.wrap(indexKey, userId, "user_index"), wrapped_by: writer.id };
          indexKey.fill(0);
          zeroKeyring(raw);
        }
        return { step, changed: await deps.store.prepare(userId, key!.wrapped_key, next, index) };
      } finally {
        fresh.fill(0);
      }
    }
    case "switch":
      return { step, changed: await deps.store.switchKeys(userId, key!) };
    case "reseal": {
      const ring = await ringFor(deps, userId);
      const { cursor, report } = await runPass(deps, userId, ring, resumeCursor(rotation!.cursor, now()), true);
      const clean = passIsClean(cursor, !!opts.acceptUnreadable);
      if (clean) await deps.store.markClean(userId, cursor.started);
      // The pass is over either way: the next one starts from the beginning with fresh counts.
      await deps.store.saveCursor(userId, {}, { moved: cursor.moved, unreadable: cursor.unreadable + cursor.failed });
      return { step, changed: cursor.moved > 0, report, clean };
    }
    case "retire":
      return { step, changed: await deps.store.retire(userId, key!.previous_wrapped_key!) };
  }
}
