// Rotates users' data keys (docs/RUNBOOK.md, Rotating And Releasing Keys; src/rekey/plan.ts for the order and why).
// Each run does the step that is due for each user and says when the next one is:
//
//   pnpm --filter worker keys:rekey --user <id> [--user <id>...]   Dry run, the default: what is due, and a counting pass
//                                                                  over everything the re-seal would touch. Writes nothing.
//   pnpm --filter worker keys:rekey --all                          The same for every user with a key.
//   ... --apply                    Does the due step: prepare a new key, switch to it (15 minutes after), re-seal, retire
//                                  the old key (once a clean pass began 30 minutes after the switch).
//   ... --apply --follow           Keeps going, waiting between steps, until each user's rotation is done.
//   ... --accept-unreadable        Lets a pass that found values no key opens still count as clean. Those values were
//                                  unreadable before the job too; look at the counts per table first.
//
// With SEAL_BOUND_FIELDS on, the re-seal also binds every legacy value to its owner and place ("e2:", src/rekey/reseal.ts),
// so a rotation doubles as the move to bound values. scripts/fields-bind.ts does that alone, without a rotation.
//
// Needs the worker's key settings (KMS_KEY_NAME, and KEY_WRAPPING_KEY only while local:v1 keys remain). A user's rotation
// survives the process stopping: run the same command again. Message text, names and addresses are never printed: only
// user ids, table names, counts and codes.

import { allRows, db } from "../src/db";
import { stepUser, type PassReport } from "../src/rekey/job";
import { rekeyUnits, supabaseRekeyStore } from "../src/rekey/store";
import { keyWrappers } from "../src/vault";
import { env } from "../src/env";

const args = process.argv.slice(2);
const apply = args.includes("--apply");
const follow = args.includes("--follow");
const acceptUnreadable = args.includes("--accept-unreadable");
const all = args.includes("--all");
const users = args.flatMap((a, i) => (a === "--user" && args[i + 1] ? [args[i + 1]] : []));
const known = new Set(["--apply", "--dry-run", "--follow", "--accept-unreadable", "--all", "--user"]);
if (args.some((a, i) => a.startsWith("--") && !known.has(a)) || (!all && !users.length) || (all && users.length) || (follow && !apply)) {
  console.error("Usage: pnpm keys:rekey (--user <id> ... | --all) [--apply [--follow]] [--accept-unreadable]");
  process.exit(1);
}

const ids = all
  ? (await allRows((from, to) => db.from("user_keys").select("user_id").order("user_id").range(from, to), "load users")).map((r) => r.user_id)
  : users;
const deps = { store: supabaseRekeyStore, wrappers: await keyWrappers(), units: rekeyUnits(), bind: env.sealBoundFields };

function print(userId: string, report: PassReport | undefined) {
  for (const r of report ?? []) {
    if (!r.tally.moved && !r.tally.unreadable && !r.tally.current && !r.error) continue;
    console.log(`  ${userId} ${r.unit}: ${r.tally.current} under the current key, ${r.tally.moved} ${apply ? "moved" : "to move"}, ${r.tally.unreadable} unreadable${r.error ? `, failed (${r.error})` : ""}`);
  }
}

let failed = 0;
const pending = new Set(ids);
for (;;) {
  let soonest = Number.POSITIVE_INFINITY;
  for (const userId of [...pending]) {
    try {
      const out = await stepUser(deps, userId, { apply, start: true, acceptUnreadable });
      const s = out.step;
      const what = s.kind === "wait" ? `wait until ${new Date(s.until).toISOString()}, then ${s.then}` : s.kind === "blocked" ? `blocked (${s.reason})` : s.kind;
      console.log(`${userId}: ${apply ? "" : "would "}${what}${out.changed ? " (done)" : ""}${out.clean === undefined ? "" : out.clean ? ", clean pass" : ", not clean yet"}`);
      print(userId, out.report);
      if (s.kind === "blocked") { failed++; pending.delete(userId); continue; }
      if (s.kind === "retire" && out.changed) { pending.delete(userId); continue; }
      if (s.kind === "wait") soonest = Math.min(soonest, s.until);
      else soonest = Date.now();
    } catch (err) {
      failed++;
      pending.delete(userId);
      console.error(`${userId}: failed (${(err as { code?: string }).code ?? (err as Error).message})`);
    }
  }
  if (!follow || !pending.size) break;
  const wait = Math.max(5_000, soonest - Date.now());
  console.log(`Next step in ${Math.round(wait / 1000)} s.`);
  await new Promise((r) => setTimeout(r, wait));
}

if (!apply) console.log("Nothing was written. Run again with --apply.");
process.exit(failed ? 1 : 0);
