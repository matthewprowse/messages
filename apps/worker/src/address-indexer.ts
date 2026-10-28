// Fills in the blind indexes (encryption stage 2) for rows written without one: everything stored before
// indexes existed, and rows from writers that do not work them out yet. Only the workers hold the keys, so
// the database leaves the index empty and this finds it. A changed value clears its index
// (20261025000400), so it is picked up again here.

import { addressIndex, chatIndex, domainIndex, ruleTargetIndex } from "@messages/crypto/addresses";
import { FIELD } from "@messages/crypto/fields";
import type { UserKeys } from "@messages/crypto";
import type { Json } from "@messages/db";
import { db, must } from "./db";
import { log, errorCode } from "./log";
import { keysFor, openStrict as open } from "./vault";

const INDEX_MS = 30_000;
const PAGE = 200;

type Table = "contact_identities" | "messages" | "threads" | "unsubscribes" | "organizations" | "priority_rules" | "accounts" | "address_book_cards";
interface Pending {
  id: string;
  value: string | null;
  to_value?: string[] | null;
  idx: string | null;
  to_idx?: string[] | null;
  /** Address book cards only: their numbers, and those numbers' indexes. */
  phones?: string[];
  phone_idx?: string[];
}

// For each table: which rows still need an index, and how to work it out.
const TABLES: { table: Table; select: string; todo: string; index: (keys: UserKeys, row: Record<string, unknown>, user: string) => Promise<Pending> }[] = [
  {
    table: "contact_identities",
    select: "id, user_id, value",
    todo: "value_index",
    index: async (keys, r, user) => {
      const value = (await open(user, FIELD.address, r.value as string)) ?? "";
      return { id: r.id as string, value: r.value as string, idx: await addressIndex(keys, value) };
    },
  },
  {
    // to_indexes is always written, empty when there is no one, so a null marks a row not yet indexed.
    table: "messages",
    select: "id, user_id, sender_address, to_addresses",
    todo: "to_indexes",
    index: async (keys, r, user) => {
      const sender = await open(user, FIELD.address, r.sender_address as string | null);
      const to = (r.to_addresses as string[] | null) ?? [];
      const opened = await Promise.all(to.map((a) => open(user, FIELD.address, a)));
      return {
        id: r.id as string,
        value: r.sender_address as string | null,
        to_value: r.to_addresses as string[] | null,
        idx: sender ? await addressIndex(keys, sender) : null,
        to_idx: await Promise.all(opened.map((a) => addressIndex(keys, a ?? ""))),
      };
    },
  },
  {
    table: "threads",
    select: "id, user_id, provider_thread_id",
    todo: "provider_thread_index",
    index: async (keys, r, user) => {
      const value = (await open(user, FIELD.address, r.provider_thread_id as string)) ?? "";
      return { id: r.id as string, value: r.provider_thread_id as string, idx: await chatIndex(keys, value) };
    },
  },
  {
    table: "unsubscribes",
    select: "id, user_id, sender_address",
    todo: "sender_index",
    index: async (keys, r, user) => {
      const value = (await open(user, FIELD.address, r.sender_address as string)) ?? "";
      return { id: r.id as string, value: r.sender_address as string, idx: await addressIndex(keys, value) };
    },
  },
  {
    table: "organizations",
    select: "id, user_id, domain",
    todo: "domain_index",
    index: async (keys, r, user) => {
      const value = (await open(user, FIELD.domain, r.domain as string)) ?? "";
      return { id: r.id as string, value: r.domain as string, idx: await domainIndex(keys, value) };
    },
  },
  {
    table: "priority_rules",
    select: "id, user_id, target",
    todo: "target_index",
    index: async (keys, r, user) => {
      const value = (await open(user, FIELD.address, r.target as string)) ?? "";
      return { id: r.id as string, value: r.target as string, idx: await ruleTargetIndex(keys, value) };
    },
  },
  {
    // An account always has its own address indexed, even when it is empty (a WhatsApp link not finished).
    table: "accounts",
    select: "id, user_id, address, send_addresses",
    todo: "send_address_indexes",
    index: async (keys, r, user) => {
      const address = (await open(user, FIELD.address, r.address as string)) ?? "";
      const sends = (r.send_addresses as string[] | null) ?? [];
      const opened = await Promise.all(sends.map((a) => open(user, FIELD.address, a)));
      return {
        id: r.id as string,
        value: r.address as string,
        to_value: r.send_addresses as string[] | null,
        idx: address ? await addressIndex(keys, address) : null,
        to_idx: await Promise.all(opened.map((a) => addressIndex(keys, a ?? ""))),
      };
    },
  },
  {
    table: "address_book_cards",
    select: "id, user_id, emails, phones",
    todo: "email_indexes",
    index: async (keys, r, user) => {
      const emails = (r.emails as string[] | null) ?? [];
      const phones = (r.phones as string[] | null) ?? [];
      const [e, p] = await Promise.all([emails, phones].map((list) => Promise.all(list.map(async (v) => addressIndex(keys, (await open(user, FIELD.address, v)) ?? "")))));
      // value and to_value carry the emails and phones as read, idx and to_idx their indexes.
      return { id: r.id as string, value: null, to_value: emails, phones, idx: null, to_idx: e, phone_idx: p };
    },
  },
];

const write = (table: Table, rows: Pending[]) => db.rpc("set_address_indexes", { p_table: table, p_rows: rows as unknown as Json });

/** One pass over every table. Returns how many rows were indexed. */
export async function indexAddresses(): Promise<number> {
  let total = 0;
  for (const { table, select, todo, index } of TABLES) {
    // Rows that cannot be written (changed mid-pass) stay unindexed; skipping them by ID keeps a pass finite.
    let after: string | null = null;
    for (;;) {
      let query = db.from(table).select(select).is(todo, null).order("id").limit(PAGE);
      if (after) query = query.gt("id", after);
      const rows = must(await query, `load ${table} to index`) as unknown as Record<string, unknown>[];
      if (!rows.length) break;
      after = rows[rows.length - 1].id as string;
      // A row with a value that cannot be opened is skipped, never indexed as if it were empty: it stays
      // unindexed and is tried again next pass.
      let failed = 0;
      const results = await Promise.all(
        rows.map(async (r) => {
          try {
            return await index(await keysFor(r.user_id as string), r, r.user_id as string);
          } catch {
            failed++;
            return null;
          }
        }),
      );
      if (failed) log.warn("rows skipped, a value could not be opened", { table, rows: failed });
      const pending = results.filter((p): p is Pending => p !== null);
      if (!pending.length) {
        if (rows.length < PAGE) break;
        continue;
      }
      const { data, error } = await write(table, pending);
      if (error) throw new Error(`${table}: ${error.message}`);
      total += data ?? 0;
      if (rows.length < PAGE) break;
    }
  }
  return total;
}

export function startAddressIndexer() {
  let running = false;
  const pass = async () => {
    if (running) return;
    running = true;
    try {
      const indexed = await indexAddresses();
      if (indexed) log.info("addresses indexed", { rows: indexed });
    } catch (err) {
      log.error("address indexing failed", { code: errorCode(err) });
    } finally {
      running = false;
    }
  };
  void pass();
  setInterval(pass, INDEX_MS);
}
