// Seals every legacy value ("e1:", and "e1b:" files) of users again bound to its owner and place ("e2:", "e2b:",
// packages/crypto/src/bound.ts), with the keys they have now: the move to bound values without a key rotation
// (docs/RUNBOOK.md, Binding Values To Their Place). keys:rekey does the same as part of a rotation.
//
//   pnpm --filter worker fields:bind --user <id> [--user <id>...]   Dry run, the default: counts, per table and bucket, what
//                                                                   would be sealed again. Writes nothing.
//   pnpm --filter worker fields:bind --all                          The same for every user with a key.
//   ... --apply                                                     Writes, through the same guarded rekey_write as keys:rekey.
//
// Refuses to run unless SEAL_BOUND_FIELDS is "true": bound values are only written once every reader can open them.
// Idempotent and safe beside a rotation: a value already bound is left alone, and a write only lands where the row still
// holds what was read. Message text, names and addresses are never printed: only user ids, table names, counts and codes.

import { allRows, db } from "../src/db";
import { env } from "../src/env";
import { bindPass } from "../src/rekey/job";
import { rekeyUnits, supabaseRekeyStore } from "../src/rekey/store";
import { keyWrappers } from "../src/vault";

const args = process.argv.slice(2);
const apply = args.includes("--apply");
const all = args.includes("--all");
const users = args.flatMap((a, i) => (a === "--user" && args[i + 1] ? [args[i + 1]] : []));
const known = new Set(["--apply", "--dry-run", "--all", "--user"]);
if (args.some((a) => a.startsWith("--") && !known.has(a)) || (!all && !users.length) || (all && users.length)) {
  console.error("Usage: pnpm fields:bind (--user <id> ... | --all) [--apply]");
  process.exit(1);
}
if (!env.sealBoundFields) {
  console.error("SEAL_BOUND_FIELDS is not \"true\". Turn it on (workers and web app released first) before binding stored values.");
  process.exit(1);
}

const ids = all
  ? (await allRows((from, to) => db.from("user_keys").select("user_id").order("user_id").range(from, to), "load users")).map((r) => r.user_id)
  : users;
const deps = { store: supabaseRekeyStore, wrappers: await keyWrappers(), units: rekeyUnits() };

let failed = 0;
let left = 0;
for (const userId of ids) {
  try {
    const { cursor, report } = await bindPass(deps, userId, apply);
    for (const r of report) {
      if (!r.tally.moved && !r.tally.unreadable && !r.error) continue;
      console.log(`  ${userId} ${r.unit}: ${r.tally.moved} ${apply ? "bound" : "to bind"}, ${r.tally.unreadable} unreadable${r.error ? `, failed (${r.error})` : ""}`);
    }
    left += apply ? 0 : cursor.moved;
    if (cursor.failed) failed++;
    console.log(`${userId}: ${cursor.moved} ${apply ? "bound" : "to bind"}, ${cursor.unreadable} unreadable${cursor.failed ? `, ${cursor.failed} units failed` : ""}`);
  } catch (err) {
    failed++;
    console.error(`${userId}: failed (${(err as { code?: string }).code ?? (err as Error).message})`);
  }
}

if (!apply) console.log(`${left} values would be bound. Nothing was written. Run again with --apply.`);
process.exit(failed ? 1 : 0);
