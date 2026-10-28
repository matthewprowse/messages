// One-off: rewrites styled Unicode letters (maths bold, script, full-width) already stored as plain
// text. New mail is cleaned on import. Safe to run again: unchanged rows are skipped.

import { db, must } from "../src/db";
import { plainLetters } from "../src/ingest/normalize-email";

const PAGE = 500;

async function clean<T extends { id: string }>(table: "messages" | "threads" | "contacts", columns: (keyof T & string)[]) {
  let changed = 0;
  for (let from = 0; ; from += PAGE) {
    const rows = must(
      await db.from(table).select(["id", ...columns].join(", ")).order("id").range(from, from + PAGE - 1),
      `load ${table}`,
    ) as unknown as T[];
    for (const row of rows) {
      const patch: Record<string, string> = {};
      for (const c of columns) {
        const value = row[c];
        if (typeof value === "string" && plainLetters(value) !== value) patch[c] = plainLetters(value);
      }
      if (Object.keys(patch).length === 0) continue;
      must(await db.from(table).update(patch as never).eq("id", row.id), `update ${table}`);
      changed++;
    }
    if (rows.length < PAGE) break;
  }
  console.log(`${table}: ${changed} updated`);
}

await clean<{ id: string; subject: string | null; preview: string | null; body_text: string | null }>("messages", ["subject", "preview", "body_text"]);
await clean<{ id: string; subject: string | null; last_message_preview: string | null }>("threads", ["subject", "last_message_preview"]);
await clean<{ id: string; display_name: string }>("contacts", ["display_name"]);
