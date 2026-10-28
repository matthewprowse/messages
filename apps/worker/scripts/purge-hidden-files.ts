// One-off: removes the stored copies of hidden attachments (tiny images and files from junk
// conversations) from the private attachments bucket, and clears their storage_path. The
// originals stay in the mailbox; if a file is shown again later, the worker's catch-up fetches it again.
//
//   npx tsx --env-file=.env scripts/purge-hidden-files.ts --dry-run
//   npx tsx --env-file=.env scripts/purge-hidden-files.ts [--reasons=tiny,junk]
//
// Prints counts only, never file names.

import { allRows, db, must } from "../src/db";
import { ATTACHMENTS_BUCKET } from "../src/storage";
import { chunks } from "../src/util";

const PURGEABLE = ["tiny", "junk"];
const BATCH = 100;

const dryRun = process.argv.includes("--dry-run");
const reasonsArg = process.argv.find((a) => a.startsWith("--reasons="))?.slice("--reasons=".length);
const reasons = reasonsArg ? reasonsArg.split(",").map((r) => r.trim()).filter(Boolean) : PURGEABLE;
const unknown = reasons.filter((r) => !PURGEABLE.includes(r));
if (unknown.length) {
  console.error(`Only these reasons can be purged: ${PURGEABLE.join(", ")}`);
  process.exit(1);
}

// Every row is loaded, a page at a time, before any is changed: clearing a path takes a row out of the filter.
const rows = await allRows(
  (from, to) =>
    db
      .from("attachments")
      .select("id, hidden_reason, size_bytes, storage_path")
      .eq("hidden", true)
      .in("hidden_reason", reasons)
      .not("storage_path", "is", null)
      .order("id")
      .range(from, to),
  "load hidden attachments",
);

const byReason = new Map<string, { files: number; bytes: number }>();
for (const r of rows) {
  const entry = byReason.get(r.hidden_reason!) ?? { files: 0, bytes: 0 };
  entry.files++;
  entry.bytes += r.size_bytes ?? 0;
  byReason.set(r.hidden_reason!, entry);
}
console.log(dryRun ? "Dry run, nothing changed." : "Purging.");
for (const [reason, { files, bytes }] of byReason) console.log(`${reason}: ${files} files, ${(bytes / 1024).toFixed(0)} KB`);
if (rows.length === 0) console.log("Nothing to purge.");

if (!dryRun) {
  let removed = 0;
  let cleared = 0;
  for (const batch of chunks(rows, BATCH)) {
    // Clear storage_path first, and only on rows that are still hidden, then remove just those objects.
    // A row shown again in the meantime keeps its file; a row shown again afterwards has no path, so
    // the worker's catch-up fetches it again.
    const pathOf = new Map(batch.map((r) => [r.id, r.storage_path!]));
    const still = must(
      await db.from("attachments").update({ storage_path: null }).in("id", batch.map((r) => r.id)).eq("hidden", true).select("id"),
      "clear storage paths",
    );
    cleared += still.length;
    if (still.length === 0) continue;
    // One stored file can serve several rows (the same file forwarded twice is kept once): an object that a row
    // outside this purge still points at is left in place.
    const candidates = [...new Set(still.map((r) => pathOf.get(r.id)!))];
    const inUse = new Set(
      must(await db.from("attachments").select("storage_path").in("storage_path", candidates), "check shared files").map((r) => r.storage_path),
    );
    const removable = candidates.filter((p) => !inUse.has(p));
    if (removable.length === 0) continue;
    const { data, error } = await db.storage.from(ATTACHMENTS_BUCKET).remove(removable);
    if (error) {
      console.error("storage remove failed", (error as { statusCode?: string }).statusCode ?? "STORAGE");
      process.exit(1);
    }
    removed += data?.length ?? 0;
  }
  console.log(`Removed ${removed} stored files, cleared ${cleared} rows.`);
}
process.exit(0);
