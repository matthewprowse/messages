// One-off: seals the attachment files stored before the workers sealed them (email, WhatsApp, Instagram), and fills in
// attachments.content_hash (an HMAC of the file under the user's index key) so the same file is stored once from now on.
// Or, with --decrypt, puts the plain bytes back.
//
//   npx tsx --env-file=.env scripts/encrypt-attachments.ts                  Dry run (the default): counts and sizes, writes nothing.
//   npx tsx --env-file=.env scripts/encrypt-attachments.ts --apply          Seals the files and marks their rows sealed.
//   npx tsx --env-file=.env scripts/encrypt-attachments.ts --decrypt --apply   The way back.
//   add --limit=200 to stop after that many files, --user=<id> to do one person.
//
// Needs 20261102400000_encrypted_fields_and_files.sql applied first. Each object is downloaded, sealed, checked to open
// back to the same bytes, uploaded over the old one, and only then are its rows marked sealed, so a failure part way
// leaves the old file in place. The web app opens a file as sealed or plain by the row's flag, so run it with the app
// closed, or accept that a file may fail to preview for the moment between the upload and the flag. Files that several
// rows share (the same path) are done once. It does not merge existing duplicates; it only sets their hashes. Prints
// counts and byte totals only, never a name.

import { allRows, db, must } from "../src/db";
import { planOpen, planSeal } from "../src/backfill/files";
import { ATTACHMENTS_BUCKET, storedType, uploadObject } from "../src/storage";
import { keysFor } from "../src/vault";

const args = process.argv.slice(2);
const decrypt = args.includes("--decrypt");
const apply = args.includes("--apply");
const limit = Number(args.find((a) => a.startsWith("--limit="))?.slice("--limit=".length)) || Infinity;
const onlyUser = args.find((a) => a.startsWith("--user="))?.slice("--user=".length);

console.log(`Mode: ${decrypt ? "decrypt" : "encrypt"}${apply ? "" : " (dry run, nothing is written)"}\n`);

// Every row is loaded before any is changed: marking a row sealed takes it out of the filter.
const rows = await allRows(
  (from, to) => {
    let q = db
      .from("attachments")
      .select("id, user_id, storage_path, mime_type, size_bytes, sealed, content_hash")
      .not("storage_path", "is", null)
      .order("id")
      .range(from, to);
    q = decrypt ? q.eq("sealed", true) : q.or("sealed.eq.false,content_hash.is.null");
    return onlyUser ? q.eq("user_id", onlyUser) : q;
  },
  "load stored attachments",
);

const byPath = new Map<string, typeof rows>();
for (const r of rows) byPath.set(r.storage_path!, [...(byPath.get(r.storage_path!) ?? []), r]);
console.log(`${rows.length} rows, ${byPath.size} stored files, ${(rows.reduce((n, r) => n + Number(r.size_bytes ?? 0), 0) / 1024 ** 2).toFixed(0)} MB (rows count shared files once each below)\n`);

let done = 0;
let sealedNow = 0;
let alreadyFine = 0;
let failed = 0;
for (const [path, group] of byPath) {
  if (done >= limit) break;
  done++;
  const first = group[0];
  try {
    if (!apply) {
      // Cheap in a dry run: the flag says what would happen, no download.
      if (decrypt || !first.sealed) sealedNow++;
      else alreadyFine++;
      continue;
    }
    const { data, error } = await db.storage.from(ATTACHMENTS_BUCKET).download(path);
    if (error || !data) throw new Error("download failed");
    const stored = new Uint8Array(await data.arrayBuffer());
    const keys = await keysFor(first.user_id);
    const plan = decrypt ? await planOpen(keys, stored) : await planSeal(keys, stored);
    if (plan.upload) {
      await uploadObject(ATTACHMENTS_BUCKET, path, Buffer.from(plan.upload), decrypt ? storedType(first.mime_type) : "application/octet-stream");
      sealedNow++;
    } else {
      alreadyFine++;
    }
    must(
      await db.from("attachments").update({ sealed: plan.sealed, content_hash: plan.hash }).in("id", group.map((g) => g.id)),
      "mark attachments",
    );
  } catch {
    failed++;
  }
}

console.log(`${apply ? (decrypt ? "Opened" : "Sealed") : decrypt ? "Would open" : "Would seal"}: ${sealedNow}. Already in the wanted form: ${alreadyFine}.${failed ? ` Failed: ${failed} (left as they were).` : ""}`);
process.exit(failed ? 1 : 0);
