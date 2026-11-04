// One-off: seals the calendar text stored readable before it was sealed (security audit 2026-11-03, H5): each event's
// notes, calendar name, join link, iCloud file and guest list (and its title and location, if encrypt-fields.ts has not
// yet), the text and guests of settled calendar_outbox and calendar_updates rows, and the join link, Meet code and Teams
// meeting ID in meetings.provider_meta. src/backfill/calendar.ts says which columns and how.
//
//   npx tsx --env-file=.env scripts/encrypt-calendar.ts                    Dry run (the default). Seals every value in
//                                                                           memory, checks it opens back, writes nothing.
//   npx tsx --env-file=.env scripts/encrypt-calendar.ts --apply            Writes the sealed values.
//   add --only=calendar_events,meetings to limit it to some tables.
//
// Needs 20261125110000_calendar_sealed_text.sql applied first: the queues' checks refuse sealed text before it. Run it
// after the worker and the web app that read sealed calendar text are released, or they show the sealed text as empty.
// A row is written only while its updated_at (its status, on the queues) is still what was read, so a row the sync
// changes mid-run is left for the next run. Queued rows still waiting for the worker are skipped. Values already sealed
// are skipped, so it is safe to run again. It prints counts only, never a value. There is no way back: the app and the
// workers read sealed and plain rows alike, so none is needed.

import { db, must } from "../src/db";
import { CALENDAR_SPECS, planCalendarRow, type CalendarSpec } from "../src/backfill/calendar";
import { keysFor } from "../src/vault";

const args = process.argv.slice(2);
const apply = args.includes("--apply");
const only = args.find((a) => a.startsWith("--only="))?.slice("--only=".length).split(",").filter(Boolean);
const PAGE = 500;

type Row = Record<string, unknown> & { id: string; user_id: string };

async function page(spec: CalendarSpec, after: string | null): Promise<Row[]> {
  const select = [...new Set(["id", "user_id", spec.guard, ...spec.columns.map((c) => c.column)])].join(", ");
  let query = db.from(spec.table).select(select).order("id").limit(PAGE);
  if (spec.settled) query = query.in("status", spec.settled);
  if (after) query = query.gt("id", after);
  return must(await query, `load ${spec.table}`) as unknown as Row[];
}

async function write(spec: CalendarSpec, id: string, guard: unknown, set: Record<string, unknown>): Promise<number> {
  const query = db
    .from(spec.table as "meetings")
    .update(set as never)
    .eq("id", id)
    .eq(spec.guard as "id", guard as string);
  return must(await query.select("id"), `update ${spec.table}`).length;
}

console.log(`Mode: encrypt${apply ? "" : " (dry run, nothing is written)"}\n`);
let problems = 0;

for (const spec of CALENDAR_SPECS) {
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
        const plan = await planCalendarRow(await keysFor(row.user_id), spec, row);
        if (!plan) continue;
        changed++;
        if (apply) written += await write(spec, row.id, plan.guard, plan.set);
      } catch {
        failed++;
        problems++;
      }
    }
    if (rows.length < PAGE) break;
  }
  const raced = changed - written - failed;
  console.log(`${spec.table.padEnd(18)} ${String(changed).padStart(6)} rows to seal${failed ? `, ${failed} FAILED` : ""}${apply ? `, ${written} written${raced > 0 ? `, ${raced} changed during the run (run again)` : ""}` : ""}`);
}

console.log(problems ? `\n${problems} rows could not be processed and were left as they are.` : "\nEvery value checked out.");
process.exit(problems ? 1 : 0);
