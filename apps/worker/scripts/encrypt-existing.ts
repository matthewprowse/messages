import { createHash } from "node:crypto";
import { decryptField, encryptField, isCiphertext } from "@messages/crypto";
import { FIELD, type Field } from "@messages/crypto/fields";
import { db, must } from "../src/db";
import { keysFor } from "../src/vault";

// One-off: encrypts message text stored before ENCRYPT_CONTENT was switched on (encryption stage 1),
// or, with --decrypt, turns it back into plain text.
//
//   pnpm encrypt-existing              Dry run. Encrypts every value in memory, checks it opens back to
//                                      exactly the original, and writes nothing.
//   pnpm encrypt-existing --apply      Writes the encrypted values.
//   pnpm encrypt-existing --decrypt    The way back: writes the values as plain text again.
//
// Writes go through public.encrypt_existing_write, which only writes a row whose text still matches what
// this read, so a message edited mid-run is left for the next run. It was dropped once the backfill was
// done (20261024190000): re-apply 20261024180000_encrypt_existing_write.sql before --apply or --decrypt. Values already in the wanted form are
// skipped, so it is safe to run again. Close the app while it writes: every change is pushed to open tabs.

type Mode = "dry-run" | "apply" | "decrypt";
type Table = "drafts" | "draft_outcomes" | "outbox" | "message_ai" | "threads" | "messages";
interface Column {
  /** The column, or "quote" for the quoted text in a WhatsApp message's provider_meta. */
  column: string;
  field: Field;
}

// Smallest first, so a problem shows up before the large tables are touched.
const TABLES: { table: Table; key: "id" | "message_id"; columns: Column[] }[] = [
  { table: "drafts", key: "id", columns: [{ column: "body", field: FIELD.draft }, { column: "instruction", field: FIELD.instruction }] },
  { table: "draft_outcomes", key: "id", columns: [{ column: "draft_body", field: FIELD.draft }, { column: "sent_body", field: FIELD.body }] },
  { table: "outbox", key: "id", columns: [{ column: "body", field: FIELD.body }, { column: "subject", field: FIELD.subject }] },
  { table: "message_ai", key: "message_id", columns: [{ column: "summary", field: FIELD.summary }] },
  {
    table: "threads",
    key: "id",
    columns: [{ column: "subject", field: FIELD.subject }, { column: "last_message_preview", field: FIELD.preview }, { column: "summary", field: FIELD.summary }],
  },
  {
    table: "messages",
    key: "id",
    columns: [
      { column: "subject", field: FIELD.subject },
      { column: "preview", field: FIELD.preview },
      { column: "body_text", field: FIELD.body },
      { column: "body_html", field: FIELD.html },
      { column: "list_unsubscribe", field: FIELD.unsubscribe },
      { column: "quote", field: FIELD.quote },
    ],
  },
];

const READ_PAGE = 200;
// Rows per database call. Messages carry large HTML bodies, so a big batch can pass the statement time limit.
const WRITE_BATCH: Record<Table, number> = { drafts: 50, draft_outcomes: 50, outbox: 50, message_ai: 50, threads: 50, messages: 5 };

const md5 = (text: string) => createHash("md5").update(text, "utf8").digest("hex");

type Row = Record<string, unknown> & { user_id: string; provider_meta?: { quoted?: { text?: unknown } } | null };

function valueOf(row: Row, column: string): unknown {
  return column === "quote" ? row.provider_meta?.quoted?.text : row[column];
}

// Not in the generated database types: the function is temporary.
const write = (table: Table, rows: unknown[]) =>
  (db.rpc.bind(db) as unknown as (fn: string, args: object) => PromiseLike<{ data: number | null; error: { message: string } | null }>)(
    "encrypt_existing_write",
    { p_table: table, p_rows: rows },
  );

async function run(mode: Mode) {
  console.log(`Mode: ${mode}${mode === "dry-run" ? " (nothing is written)" : ""}\n`);
  let problems = 0;
  for (const { table, key, columns } of TABLES) {
    const select = [key, "user_id", ...columns.map((c) => (c.column === "quote" ? "provider_meta" : c.column))].join(", ");
    const counts = new Map(columns.map((c) => [c.column, { changed: 0, failed: 0 }]));
    let attempted = 0;
    let written = 0;
    let pending: { id: string; columns: Record<string, { expect: string; value: string }> }[] = [];

    const flush = async () => {
      if (!pending.length || mode === "dry-run") { pending = []; return; }
      const { data, error } = await write(table, pending);
      if (error) throw new Error(`${table}: ${error.message}`);
      attempted += pending.length;
      written += data ?? 0;
      pending = [];
    };

    let after: string | null = null;
    for (;;) {
      let query = db.from(table).select(select).order(key).limit(READ_PAGE);
      if (after) query = query.gt(key, after);
      const rows = must(await query, `load ${table}`) as unknown as Row[];
      if (!rows.length) break;
      after = rows[rows.length - 1][key] as string;

      for (const row of rows) {
        const keys = await keysFor(row.user_id);
        const change: Record<string, { expect: string; value: string }> = {};
        for (const { column, field } of columns) {
          const value = valueOf(row, column);
          if (typeof value !== "string" || isCiphertext(value) === (mode !== "decrypt")) continue;
          const count = counts.get(column)!;
          try {
            let next: string;
            if (mode === "decrypt") {
              next = await decryptField(keys, field, value);
            } else {
              next = await encryptField(keys, field, value);
              // Checked before anything is written: it must open back to exactly what was read.
              if ((await decryptField(keys, field, next)) !== value) throw new Error("does not round-trip");
            }
            change[column] = { expect: md5(value), value: next };
            count.changed++;
          } catch {
            count.failed++;
            problems++;
          }
        }
        if (Object.keys(change).length) pending.push({ id: row[key] as string, columns: change });
        if (pending.length >= WRITE_BATCH[table]) await flush();
      }
    }
    await flush();

    for (const { column } of columns) {
      const c = counts.get(column)!;
      console.log(`${`${table}.${column}`.padEnd(28)} ${String(c.changed).padStart(5)} to ${mode === "decrypt" ? "decrypt" : "encrypt"}${c.failed ? `, ${c.failed} FAILED` : ""}`);
    }
    if (mode !== "dry-run") {
      const skipped = attempted - written;
      console.log(`${"".padEnd(28)} ${written} rows written${skipped ? `, ${skipped} skipped (changed during the run: run again)` : ""}`);
    }
    console.log("");
  }
  console.log(problems ? `${problems} values could not be processed and were left as they are.` : "Every value checked out.");
}

const mode: Mode = process.argv.includes("--apply") ? "apply" : process.argv.includes("--decrypt") ? "decrypt" : "dry-run";
run(mode).catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
