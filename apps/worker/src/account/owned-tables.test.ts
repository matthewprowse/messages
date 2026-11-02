// OWNED_TABLES (owned-tables.ts) against the real migrations: every table that has a user_id column is listed, none listed is
// gone, and each one cascades from auth.users so deleting the auth user deletes its rows.

import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { OWNED_TABLES } from "./owned-tables";

const dir = join(dirname(fileURLToPath(import.meta.url)), "../../../../supabase/migrations");
const CASCADE = /references\s+auth\.users\s*\(\s*id\s*\)\s+on delete cascade/i;

/** Tables with a user_id column across all migrations in order, and whether that column cascades. */
function userTables(): Map<string, { cascades: boolean }> {
  const found = new Map<string, { cascades: boolean }>();
  for (const file of readdirSync(dir).filter((f) => f.endsWith(".sql")).sort()) {
    const sql = readFileSync(join(dir, file), "utf8").replace(/--.*$/gm, "");
    for (const m of sql.matchAll(/create table (?:if not exists )?(?:public\.)?(\w+)\s*\(([\s\S]*?)\n\)\s*;/gi)) {
      const column = m[2].split("\n").find((l) => /^\s*user_id\b/.test(l));
      if (column) found.set(m[1], { cascades: CASCADE.test(column) });
    }
    for (const m of sql.matchAll(/alter table (?:if exists )?(?:public\.)?(\w+)\s+add column (?:if not exists )?user_id\b([^;,]*)/gi)) {
      found.set(m[1], { cascades: CASCADE.test(m[2]) });
    }
    for (const m of sql.matchAll(/^\s*drop table (?:if exists )?(?:public\.)?(\w+)/gim)) found.delete(m[1]);
  }
  return found;
}

test("the migrations are found and parsed", () => {
  assert.ok(userTables().size > 40);
});

test("every table with a user_id column is in OWNED_TABLES, so a new one cannot escape account deletion", () => {
  const missing = [...userTables().keys()].filter((t) => !(OWNED_TABLES as readonly string[]).includes(t));
  assert.deepEqual(missing, [], `add to OWNED_TABLES (apps/worker/src/account/owned-tables.ts): ${missing.join(", ")}`);
});

test("OWNED_TABLES names no table that has gone", () => {
  const real = userTables();
  assert.deepEqual(OWNED_TABLES.filter((t) => !real.has(t)), []);
});

test("every user_id column cascades from auth.users", () => {
  const loose = [...userTables()].filter(([, v]) => !v.cascades).map(([t]) => t);
  assert.deepEqual(loose, [], `these user_id columns do not cascade, so deleting the auth user would leave rows: ${loose.join(", ")}`);
});

test("OWNED_TABLES has no duplicates", () => {
  assert.equal(new Set(OWNED_TABLES).size, OWNED_TABLES.length);
});
