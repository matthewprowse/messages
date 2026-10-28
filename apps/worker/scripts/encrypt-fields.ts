// One-off: encrypts the text fields that were stored readable (docs/PLAN.md, Privacy and Encryption, Code Check):
// writing examples, style rules, the contact fields company, role, relationship, style note and AI summary, address
// book card names, calendar titles and locations, meeting participant names, and attachment file names. It also
// replaces the text in email_originals.error and briefs.error with a short code.
//
//   npx tsx --env-file=.env scripts/encrypt-fields.ts                 Dry run (the default). Seals every value in memory,
//                                                                      checks it opens back, and writes nothing.
//   npx tsx --env-file=.env scripts/encrypt-fields.ts --apply          Writes the sealed values.
//   npx tsx --env-file=.env scripts/encrypt-fields.ts --decrypt        The way back: plain text again (a dry run unless --apply is also given).
//   add --only=contacts,attachments to limit it to some tables.
//
// Needs 20261102400000_encrypted_fields_and_files.sql applied first (attachments gain file_ext, keep_hint and is_sticker,
// which are set from the plain name as it is sealed). A row is written only while every column it changes still holds
// the value that was read, so a row edited mid-run is left for the next run. Values already in the wanted form are
// skipped, so it is safe to run again. Close the app while it writes: every change is pushed to open tabs. It prints
// counts only, never a value.
//
// Error columns cannot be restored by --decrypt: the old text is gone by design.

import { decryptField } from "@messages/crypto";
import { allRows, db, must } from "../src/db";
import { errorCodeFor, planRow, SPECS, type Mode } from "../src/backfill/fields";
import { keysFor } from "../src/vault";

const args = process.argv.slice(2);
const decrypt = args.includes("--decrypt");
const apply = args.includes("--apply");
const mode: Mode = decrypt ? "decrypt" : "encrypt";
const writing = apply;
const only = args.find((a) => a.startsWith("--only="))?.slice("--only=".length).split(",").filter(Boolean);
const PAGE = 1000;

console.log(`Mode: ${mode}${writing ? "" : " (dry run, nothing is written)"}\n`);
let problems = 0;

for (const spec of SPECS) {
  if (only && !only.includes(spec.table)) continue;
  const select = ["id", "user_id", ...spec.columns.map((c) => c.column)].join(", ");
  let changed = 0;
  let failed = 0;
  let written = 0;
  let after: string | null = null;
  for (;;) {
    const rows = (await allRowsAfter(spec.table, select, after, PAGE)) as unknown as (Record<string, unknown> & { id: string; user_id: string })[];
    if (!rows.length) break;
    after = rows[rows.length - 1].id;
    for (const row of rows) {
      try {
        const keys = await keysFor(row.user_id);
        const plan = await planRow(keys, spec, row, mode);
        if (!plan) continue;
        if (mode === "encrypt") {
          // Checked before anything is written: every value must open back to exactly what was read.
          for (const { column, field } of spec.columns) {
            if (column in plan.set) {
              const back = await decryptField(keys, field, plan.set[column] as string);
              if (back !== plan.expect[column]) throw new Error("does not round-trip");
            }
          }
        }
        changed++;
        if (!writing) continue;
        let query = db.from(spec.table as "contacts").update(plan.set as never).eq("id", row.id);
        for (const [column, value] of Object.entries(plan.expect)) query = query.eq(column as "id", value as string);
        const updated = must(await query.select("id"), `update ${spec.table}`);
        written += updated.length;
      } catch {
        failed++;
        problems++;
      }
    }
    if (rows.length < PAGE) break;
  }
  console.log(`${spec.table.padEnd(24)} ${String(changed).padStart(6)} rows to ${mode}${failed ? `, ${failed} FAILED` : ""}${writing ? `, ${written} written${changed - written - failed ? `, ${changed - written - failed} changed during the run (run again)` : ""}` : ""}`);
}

if (!decrypt) {
  for (const table of ["email_originals", "briefs"] as const) {
    if (only && !only.includes(table)) continue;
    const rows = await allRows(
      (from, to) => db.from(table).select("id, error").not("error", "is", null).order("id").range(from, to),
      `load ${table} errors`,
    );
    const todo = rows.flatMap((r) => {
      const code = errorCodeFor(table, r.error);
      return code ? [{ id: r.id, error: r.error!, code }] : [];
    });
    let written = 0;
    if (writing) {
      for (const r of todo) written += must(await db.from(table).update({ error: r.code }).eq("id", r.id).eq("error", r.error).select("id"), `update ${table}`).length;
    }
    console.log(`${`${table}.error`.padEnd(24)} ${String(todo.length).padStart(6)} rows to replace with a code${writing ? `, ${written} written` : ""}`);
  }
}

console.log(problems ? `\n${problems} rows could not be processed and were left as they are.` : "\nEvery value checked out.");
process.exit(problems ? 1 : 0);

async function allRowsAfter(table: string, select: string, after: string | null, limit: number) {
  let query = db.from(table as "contacts").select(select).order("id").limit(limit);
  if (after) query = query.gt("id", after);
  return must(await query, `load ${table}`);
}
