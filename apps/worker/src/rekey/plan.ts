// What the re-key job does next for one user, from their user_keys row and their user_key_rotations row. Pure, so the
// order of a rotation is tested without a database. The whole rotation, in order:
//
//   prepare  A new data key is made and stored as next_wrapped_key (and, at a first rotation, the index key the user's
//            blind indexes were made with, so they never change). Every reader opens with it from their next key read;
//            nobody seals with it yet.
//   (wait)   TURNOVER_MS, longer than every key cache (workers 10 minutes, browsers refetch at 10 minutes), so every
//            reader holds the new key before anything is sealed with it.
//   switch   The new key becomes the current one (it seals) and the old one becomes previous_wrapped_key (it opens).
//   reseal   Every sealed value and file of the user is opened and sealed again with the current key, page by page,
//            resumable from the cursor. A reader that still sealed with the old key in its last cached minutes is
//            caught by a later pass.
//   retire   Once a pass that began at least GRACE_MS after the switch found nothing left to move (and nothing it could
//            not open, unless the owner accepts those), the previous key is cleared from user_keys. Nothing stored is
//            sealed under it any more.
//
// Each step writes only if the rows still say what was read, so two runs at once, or a run stopped half way, are safe.

/** Longer than any reader's key cache (KEY_CACHE_MS in packages/crypto, KEY_REFRESH_MS in apps/web/lib/vault.ts). */
export const TURNOVER_MS = 15 * 60_000;
/** How long after the switch a clean pass must begin before the old key is retired: two cache lifetimes and then some. */
export const GRACE_MS = 30 * 60_000;

/** The parts of a user_keys row the plan looks at. */
export interface KeyRowState {
  next_wrapped_key?: string | null;
  previous_wrapped_key?: string | null;
}

/** A user_key_rotations row. */
export interface RotationRow {
  phase: "prepared" | "switched" | "done";
  prepared_at: string;
  switched_at: string | null;
  clean_pass_at: string | null;
}

export type Step =
  | { kind: "prepare" }
  | { kind: "wait"; until: number; then: "switch" | "reseal" }
  | { kind: "switch" }
  | { kind: "reseal" }
  | { kind: "retire" }
  | { kind: "blocked"; reason: string };

export interface PlanOptions {
  now: number;
  turnoverMs?: number;
  graceMs?: number;
  /** Start a new rotation for a user whose last one is done (or who never had one). False only reports. */
  start: boolean;
}

/** The next step for one user. "blocked" means the rows disagree, which a person must look at; nothing is changed then. */
export function nextStep(key: KeyRowState | null, rotation: RotationRow | null, opts: PlanOptions): Step {
  const turnover = opts.turnoverMs ?? TURNOVER_MS;
  const grace = opts.graceMs ?? GRACE_MS;
  if (!key) return { kind: "blocked", reason: "no_key" };
  const next = !!key.next_wrapped_key;
  const previous = !!key.previous_wrapped_key;
  if (!rotation || rotation.phase === "done") {
    if (next || previous) return { kind: "blocked", reason: "keys_without_rotation" };
    return opts.start ? { kind: "prepare" } : { kind: "blocked", reason: "not_started" };
  }
  if (rotation.phase === "prepared") {
    if (!next || previous) return { kind: "blocked", reason: "prepared_without_next_key" };
    const until = Date.parse(rotation.prepared_at) + turnover;
    return opts.now < until ? { kind: "wait", until, then: "switch" } : { kind: "switch" };
  }
  // switched
  if (next) return { kind: "blocked", reason: "switched_with_next_key" };
  if (!previous) return { kind: "blocked", reason: "switched_without_previous_key" };
  if (!rotation.switched_at) return { kind: "blocked", reason: "switched_without_time" };
  const settled = Date.parse(rotation.switched_at) + grace;
  if (rotation.clean_pass_at && Date.parse(rotation.clean_pass_at) >= settled) return { kind: "retire" };
  // Clean already, but too soon after the switch for a reader still sealing with the old key to be ruled out.
  if (rotation.clean_pass_at && opts.now < settled) return { kind: "wait", until: settled, then: "reseal" };
  return { kind: "reseal" };
}

/** Where a pass is: the units done, the unit it is in and the key it reached there, and what it has counted. */
export interface PassCursor {
  started: string;
  done: string[];
  unit: string | null;
  after: unknown;
  moved: number;
  unreadable: number;
  /** Units that could not be walked (a table the database does not have yet, a storage error): never clean. */
  failed: number;
}

/** The cursor to continue from: the saved one when it belongs to a pass, else a new pass starting now. */
export function resumeCursor(saved: unknown, now: number): PassCursor {
  const c = saved as Partial<PassCursor> | null;
  if (c && typeof c.started === "string" && Array.isArray(c.done)) {
    return { started: c.started, done: c.done.filter((u): u is string => typeof u === "string"), unit: typeof c.unit === "string" ? c.unit : null, after: c.after ?? null, moved: Number(c.moved) || 0, unreadable: Number(c.unreadable) || 0, failed: Number(c.failed) || 0 };
  }
  return { started: new Date(now).toISOString(), done: [], unit: null, after: null, moved: 0, unreadable: 0, failed: 0 };
}

/** Whether a finished pass lets the old key be retired: nothing moved, no unit failed, nothing unreadable unless that is accepted. */
export function passIsClean(cursor: PassCursor, acceptUnreadable: boolean): boolean {
  return cursor.moved === 0 && cursor.failed === 0 && (cursor.unreadable === 0 || acceptUnreadable);
}
