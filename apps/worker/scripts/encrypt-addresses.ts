import { decryptField, encryptField, isCiphertext, type UserKeys } from "@messages/crypto";
import { addressIndex } from "@messages/crypto/addresses";
import { FIELD, type Field } from "@messages/crypto/fields";
import { db, must } from "../src/db";
import { keysFor } from "../src/vault";

// One-off: encrypts the addresses, numbers, chat IDs and company domains stored before
// ENCRYPT_ADDRESSES was switched on (encryption stage 2), or, with --decrypt, turns them back into plain
// text. The database matches on their blind indexes, which do not change, so the app keeps working
// throughout.
//
//   pnpm encrypt-addresses              Dry run. Encrypts every value in memory, checks it opens back to
//                                       exactly the original, and writes nothing.
//   pnpm encrypt-addresses --apply      Writes the encrypted values.
//   pnpm encrypt-addresses --decrypt    The way back: writes the values as plain text again.
//
// Writes go through public.encrypt_addresses_write, which only writes a row that still holds what this
// read, so a row changed mid-run is left for the next run. It was dropped once the backfill was done
// (20261025001300): re-apply it from 20261025001200_outbox_addresses.sql before --apply or --decrypt.
// Values already in the wanted form are skipped, so it is safe to run again.

type Mode = "dry-run" | "apply" | "decrypt";
type Table = "contact_identities" | "messages" | "threads" | "unsubscribes" | "organizations" | "priority_rules" | "accounts" | "address_book_cards" | "outbox";
type Kind = "text" | "list" | "meta";

interface Spec {
  table: Table;
  columns: { column: string; kind: Kind; field: Field }[];
  /** Only these rows hold addresses: email threads' IDs are Message-IDs, which stay as they are for now. */
  only?: [column: string, value: string];
}

// Smallest first, so a problem shows up before the large tables are touched.
const TABLES: Spec[] = [
  { table: "accounts", columns: [{ column: "address", kind: "text", field: FIELD.address }, { column: "send_addresses", kind: "list", field: FIELD.address }] },
  { table: "priority_rules", columns: [{ column: "target", kind: "text", field: FIELD.address }] },
  { table: "outbox", columns: [{ column: "to_addresses", kind: "list", field: FIELD.address }, { column: "from_address", kind: "text", field: FIELD.address }] },
  { table: "unsubscribes", columns: [{ column: "sender_address", kind: "text", field: FIELD.address }] },
  { table: "organizations", columns: [{ column: "domain", kind: "text", field: FIELD.domain }] },
  { table: "address_book_cards", columns: [{ column: "emails", kind: "list", field: FIELD.address }, { column: "phones", kind: "list", field: FIELD.address }] },
  { table: "contact_identities", columns: [{ column: "value", kind: "text", field: FIELD.address }] },
  { table: "threads", columns: [{ column: "provider_thread_id", kind: "text", field: FIELD.address }], only: ["channel", "whatsapp"] },
  {
    table: "messages",
    columns: [
      { column: "sender_address", kind: "text", field: FIELD.address },
      { column: "to_addresses", kind: "list", field: FIELD.address },
      { column: "provider_meta", kind: "meta", field: FIELD.address },
    ],
  },
];

/** The WhatsApp JIDs a message keeps in provider_meta (and, below, who reacted to it). */
const META_KEYS = ["chat", "participant"] as const;

const READ_PAGE = 200;
const WRITE_BATCH = 25;

type Row = Record<string, unknown> & { id: string; user_id: string };

async function convert(keys: UserKeys, field: Field, value: string, mode: Mode): Promise<string | null> {
  if (!value || isCiphertext(value) === (mode !== "decrypt")) return null; // nothing to do
  if (mode === "decrypt") return decryptField(keys, field, value);
  const sealed = await encryptField(keys, field, value);
  // Checked before anything is written: it must open back to exactly what was read.
  if ((await decryptField(keys, field, sealed)) !== value) throw new Error("does not round-trip");
  return sealed;
}

/** The new value for one column, or undefined when it is already in the wanted form. */
async function changed(keys: UserKeys, kind: Kind, field: Field, value: unknown, mode: Mode): Promise<unknown> {
  if (kind === "text") return typeof value === "string" ? ((await convert(keys, field, value, mode)) ?? undefined) : undefined;
  if (kind === "list") {
    if (!Array.isArray(value)) return undefined;
    const next = await Promise.all(value.map(async (v) => (typeof v === "string" ? ((await convert(keys, field, v, mode)) ?? v) : v)));
    return next.some((v, i) => v !== value[i]) ? next : undefined;
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const meta = value as Record<string, unknown>;
  const next = { ...meta };
  let any = false;
  for (const key of META_KEYS) {
    if (typeof meta[key] !== "string") continue;
    const v = await convert(keys, field, meta[key] as string, mode);
    if (v !== null) { next[key] = v; any = true; }
  }
  // Reactions by who reacted: keyed by the index of their number or privacy ID, who it is kept encrypted
  // in reactors (20261025001100). The way back keys them by the number again.
  const reactions = meta.reactions as Record<string, string> | undefined;
  if (reactions && typeof reactions === "object") {
    const reactors = { ...((meta.reactors as Record<string, string> | undefined) ?? {}) };
    const out: Record<string, string> = {};
    let moved = false;
    for (const [who, emoji] of Object.entries(reactions)) {
      if (who === "me") { out[who] = emoji; continue; }
      if (mode !== "decrypt" && !reactors[who]) {
        const index = await addressIndex(keys, who);
        out[index] = emoji;
        reactors[index] = (await convert(keys, field, who, mode))!;
        moved = true;
      } else if (mode === "decrypt" && reactors[who]) {
        out[await decryptField(keys, field, reactors[who])] = emoji;
        delete reactors[who];
        moved = true;
      } else {
        out[who] = emoji;
      }
    }
    if (moved) { next.reactions = out; next.reactors = reactors; any = true; }
  }
  return any ? next : undefined;
}

const write = (table: Table, rows: unknown[]) =>
  (db.rpc.bind(db) as unknown as (fn: string, args: object) => PromiseLike<{ data: number | null; error: { message: string } | null }>)(
    "encrypt_addresses_write",
    { p_table: table, p_rows: rows },
  );

async function run(mode: Mode) {
  console.log(`Mode: ${mode}${mode === "dry-run" ? " (nothing is written)" : ""}\n`);
  let problems = 0;
  for (const { table, columns, only } of TABLES) {
    const select = ["id", "user_id", ...columns.map((c) => c.column)].join(", ");
    const counts = new Map(columns.map((c) => [c.column, { changed: 0, failed: 0 }]));
    let attempted = 0;
    let written = 0;
    let pending: { id: string; expect: Record<string, unknown>; set: Record<string, unknown> }[] = [];

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
      let query = db.from(table).select(select).order("id").limit(READ_PAGE);
      if (only) query = query.eq(only[0], only[1]);
      if (after) query = query.gt("id", after);
      const rows = must(await query, `load ${table}`) as unknown as Row[];
      if (!rows.length) break;
      after = rows[rows.length - 1].id;

      for (const row of rows) {
        const keys = await keysFor(row.user_id);
        const expect: Record<string, unknown> = {};
        const set: Record<string, unknown> = {};
        for (const { column, kind, field } of columns) {
          const count = counts.get(column)!;
          try {
            const next = await changed(keys, kind, field, row[column], mode);
            if (next === undefined) continue;
            expect[column] = row[column];
            set[column] = next;
            count.changed++;
          } catch {
            count.failed++;
            problems++;
          }
        }
        if (Object.keys(set).length) pending.push({ id: row.id, expect, set });
        if (pending.length >= WRITE_BATCH) await flush();
      }
    }
    await flush();

    for (const { column } of columns) {
      const c = counts.get(column)!;
      console.log(`${`${table}.${column}`.padEnd(36)} ${String(c.changed).padStart(5)} to ${mode === "decrypt" ? "decrypt" : "encrypt"}${c.failed ? `, ${c.failed} FAILED` : ""}`);
    }
    if (mode !== "dry-run") {
      const skipped = attempted - written;
      console.log(`${"".padEnd(36)} ${written} rows written${skipped ? `, ${skipped} skipped (changed during the run: run again)` : ""}`);
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
