// export-coverage.ts against the real migrations: every table with a user_id column is exported or excluded with a reason, so
// a new feature cannot store something of the person's and leave it out of Download My Data without anyone deciding that.

import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { EXCLUDED_TABLES, EXPORTED_TABLES } from "./export-coverage";

const dir = join(dirname(fileURLToPath(import.meta.url)), "../../../../supabase/migrations");

/** Tables with a user_id column across all migrations in order (the same reading owned-tables.test.ts does in the worker). */
function userTables(): Set<string> {
  const found = new Set<string>();
  for (const file of readdirSync(dir).filter((f) => f.endsWith(".sql")).sort()) {
    const sql = readFileSync(join(dir, file), "utf8").replace(/--.*$/gm, "");
    for (const m of sql.matchAll(/create table (?:if not exists )?(?:public\.)?(\w+)\s*\(([\s\S]*?)\n\)\s*;/gi)) {
      if (m[2].split("\n").some((l) => /^\s*user_id\b/.test(l))) found.add(m[1]);
    }
    for (const m of sql.matchAll(/alter table (?:if exists )?(?:public\.)?(\w+)\s+add column (?:if not exists )?user_id\b/gi)) found.add(m[1]);
    for (const m of sql.matchAll(/^\s*drop table (?:if exists )?(?:public\.)?(\w+)/gim)) found.delete(m[1]);
  }
  return found;
}

test("every table with a user_id column is exported or excluded with a reason", () => {
  const known = new Set([...Object.keys(EXPORTED_TABLES), ...Object.keys(EXCLUDED_TABLES)]);
  const missing = [...userTables()].filter((t) => !known.has(t));
  assert.deepEqual(missing, [], `add to EXPORTED_TABLES (and export it) or EXCLUDED_TABLES (with a reason) in export-coverage.ts: ${missing.join(", ")}`);
});

test("no table is both exported and excluded, and none named has gone", () => {
  const real = userTables();
  const both = Object.keys(EXPORTED_TABLES).filter((t) => t in EXCLUDED_TABLES);
  assert.deepEqual(both, []);
  assert.deepEqual([...Object.keys(EXPORTED_TABLES), ...Object.keys(EXCLUDED_TABLES)].filter((t) => !real.has(t)), []);
});

test("every exclusion has a real reason", () => {
  for (const [table, why] of Object.entries(EXCLUDED_TABLES)) assert.ok(why.trim().length > 10 && !/[–—]/.test(why), table);
});
