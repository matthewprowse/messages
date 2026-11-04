// Read-only: can KEY_WRAPPING_KEY and ENCRYPTION_KEY be removed yet? Counts what still needs each (src/keys/readiness.ts):
// local:v1 wrapped keys in user_keys and team_keys, and "v1:" sign-ins, sessions and handoffs. Also lists rotations of
// users' data keys that are not finished. Writes nothing, calls no KMS, prints only table names and counts.
//
//   pnpm --filter worker keys:readiness
//
// Exit code 0 when both keys can go, 2 when one is still needed, 1 when a count could not be read.

import { db } from "../src/db";
import { CHECKS, readinessVerdict } from "../src/keys/readiness";

type Counter = { select(columns: string, opts: { count: "exact"; head: true }): { eq(c: string, v: string): Promise<{ count: number | null; error: unknown }>; like(c: string, v: string): Promise<{ count: number | null; error: unknown }> } };

let unreadable = false;
const counts = await Promise.all(CHECKS.map(async (c) => {
  const query = (db.from(c.table) as unknown as Counter).select("*", { count: "exact", head: true });
  const { count, error } = await (c.match === "eq" ? query.eq(c.column, c.value) : query.like(c.column, c.value));
  if (error) {
    unreadable = true;
    // A column added by a migration not yet applied reads as an error: counted as unknown, which blocks its key.
    console.error(`${c.table}.${c.column}: could not count (${(error as { code?: string }).code ?? "error"})`);
  }
  return { what: `${c.table}.${c.column}`, needs: c.needs, fix: c.fix, count: error ? null : count ?? 0 };
}));

for (const c of counts) console.log(`${c.needs.padEnd(16)} ${c.what.padEnd(36)} ${c.count ?? "?"}`);
const verdict = readinessVerdict(counts);
console.log("");
for (const [key, ready] of Object.entries(verdict.ready)) {
  console.log(ready ? `${key}: nothing needs it. It can be removed from every environment.` : `${key}: still needed.`);
}
for (const c of verdict.blocking) console.log(`  ${c.what}: ${c.count ?? "unknown"}. ${c.fix}`);

const { data: rotations, error } = await db.from("user_key_rotations").select("phase").neq("phase", "done");
if (!error && rotations?.length) console.log(`\n${rotations.length} data key rotation${rotations.length === 1 ? "" : "s"} not finished: run pnpm --filter worker keys:rekey --all --apply.`);

process.exit(unreadable ? 1 : verdict.ready.KEY_WRAPPING_KEY && verdict.ready.ENCRYPTION_KEY ? 0 : 2);
