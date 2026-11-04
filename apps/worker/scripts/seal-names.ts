// One-off: seals the contact, company and group chat names stored readable before names were sealed (audit H5):
// contacts.display_name, organizations.name and threads.group_name, each with its own user's key, and gives each
// group's name the blind index ingest tells a rename by (threads.group_name_index).
//
//   pnpm --filter worker seal-names                       Dry run (the default). Seals every name in memory, checks it
//                                                         opens back to exactly what was read, and writes nothing.
//   pnpm --filter worker seal-names --apply               Writes the sealed names.
//   pnpm --filter worker seal-names --decrypt [--apply]   The way back: readable names again.
//   add --only=contacts,threads to limit it to some tables, and --user=<id> to one person.
//
// Needs 20261125100000_sealed_names_columns.sql applied first: it works out each contact's display_name_rank from the
// readable name before this seals it, and adds group_name_index. A row is written only while the columns it changes
// still hold what was read, so a row edited mid-run is left for the next run. Names already sealed are skipped, so it is
// safe to run again. A shared chat's group name is sealed with the agent's key here, and the share job then moves it
// to the team's (the update queues it). Close the app while it writes: every change is pushed to open tabs. It prints
// counts only, never a name.

import { db, must } from "../src/db";
import { NAME_SPECS, planName, type NameMode, type NameSpec } from "../src/backfill/names";
import { keysFor } from "../src/vault";

const args = process.argv.slice(2);
const mode: NameMode = args.includes("--decrypt") ? "decrypt" : "encrypt";
const writing = args.includes("--apply");
const only = args.find((a) => a.startsWith("--only="))?.slice("--only=".length).split(",").filter(Boolean);
const user = args.find((a) => a.startsWith("--user="))?.slice("--user=".length) || null;
const PAGE = 1000;

type Row = Record<string, unknown> & { id: string; user_id: string };

async function page(spec: NameSpec, after: string | null): Promise<Row[]> {
  const select = ["id", "user_id", spec.column, ...(spec.index ? [spec.index] : [])].join(", ");
  let query = db.from(spec.table).select(select).not(spec.column, "is", null).order("id").limit(PAGE);
  if (user) query = query.eq("user_id", user);
  if (after) query = query.gt("id", after);
  return must(await query, `load ${spec.table}`) as unknown as Row[];
}

/** Writes one row's plan only while every column it changes still holds the value read. Returns whether it landed. */
async function write(spec: NameSpec, id: string, plan: { expect: Record<string, string | null>; set: Record<string, string | null> }): Promise<boolean> {
  let query = db.from(spec.table as "contacts").update(plan.set as never).eq("id", id);
  for (const [column, value] of Object.entries(plan.expect)) query = value === null ? query.is(column as "id", null) : query.eq(column as "id", value);
  return must(await query.select("id"), `update ${spec.table}`).length > 0;
}

console.log(`Mode: ${mode}${writing ? "" : " (dry run, nothing is written)"}${user ? ", one user" : ""}\n`);
let problems = 0;

for (const spec of NAME_SPECS) {
  if (only && !only.includes(spec.table)) continue;
  let changed = 0;
  let failed = 0;
  let written = 0;
  let after: string | null = null;
  for (;;) {
    const rows = await page(spec, after);
    if (!rows.length) break;
    after = rows[rows.length - 1].id;
    for (const row of rows) {
      try {
        const plan = await planName(await keysFor(row.user_id), spec, row, mode);
        if (!plan) continue;
        changed++;
        if (writing && (await write(spec, row.id, plan))) written++;
      } catch {
        failed++;
        problems++;
      }
    }
    if (rows.length < PAGE) break;
  }
  const raced = changed - written;
  console.log(`${`${spec.table}.${spec.column}`.padEnd(28)} ${String(changed).padStart(6)} rows to ${mode}${failed ? `, ${failed} FAILED` : ""}${writing ? `, ${written} written${raced ? `, ${raced} changed during the run (run again)` : ""}` : ""}`);
}

console.log(problems ? `\n${problems} names could not be processed and were left as they are.` : "\nEvery name checked out.");
process.exit(problems ? 1 : 0);
