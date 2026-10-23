import { decryptField, encryptField, isCiphertext } from "@messages/crypto";
import { FIELD } from "@messages/crypto/fields";
import { bodySource, isBulkMail } from "@messages/email-text";
import { db, must } from "../src/db";
import { keysFor } from "../src/vault";
import { marksJson } from "../src/ingest/store-email";

// One-off: drops the HTML stored with emails from before View Original fetched it on demand. What the app
// needed the HTML for is kept first, as new emails get it on arrival: is_bulk (a newsletter), has_original
// (offer View Original), and readable text from the HTML in body_text when the email's own text part is
// missing or junk, and the bold and italic runs of the HTML in body_marks.
//
//   pnpm drop-stored-html            Dry run: works everything out and writes nothing.
//   pnpm drop-stored-html --apply    Writes the flags and text, and clears body_html.
//
// Clearing the HTML cannot be undone except by fetching each email from the provider again, so anything
// else that should be taken from the stored HTML has to be added here before running with --apply.

const PAGE = 50;

const read = async (user: string, field: (typeof FIELD)[keyof typeof FIELD], value: string | null) =>
  value == null ? null : isCiphertext(value) ? decryptField(await keysFor(user), field, value) : value;

async function run(apply: boolean) {
  console.log(apply ? "Mode: apply" : "Mode: dry run (nothing is written)");
  let seen = 0, bulk = 0, derived = 0, styled = 0, failed = 0;
  let after: string | null = null;
  for (;;) {
    let query = db.from("messages").select("id, user_id, body_text, body_html").not("body_html", "is", null).order("id").limit(PAGE);
    if (after) query = query.gt("id", after);
    const rows = must(await query, "load stored HTML");
    if (!rows.length) break;
    after = rows[rows.length - 1].id;
    for (const row of rows) {
      seen++;
      try {
        const [text, html] = await Promise.all([read(row.user_id, FIELD.body, row.body_text), read(row.user_id, FIELD.html, row.body_html)]);
        const isBulk = isBulkMail(html);
        const source = bodySource(text, html);
        const textChanged = source !== (text ?? "");
        const marks = html ? marksJson(html) : null;
        if (marks) styled++;
        if (isBulk) bulk++;
        if (textChanged) derived++;
        if (!apply) continue;
        const patch: { body_html: null; has_original: boolean; is_bulk: boolean; body_text?: string; body_marks?: string } = { body_html: null, has_original: true, is_bulk: isBulk };
        const encrypted = isCiphertext(row.body_text ?? row.body_html);
        // Kept encrypted if it was: every stored value is ciphertext since encryption stage 1.
        if (textChanged) patch.body_text = encrypted ? await encryptField(await keysFor(row.user_id), FIELD.body, source) : source;
        if (marks) patch.body_marks = encrypted ? await encryptField(await keysFor(row.user_id), FIELD.marks, marks) : marks;
        must(await db.from("messages").update(patch).eq("id", row.id), "save message");
      } catch {
        failed++;
      }
    }
    // In a dry run nothing changes, so paging continues past this page; with --apply the rows drop out.
  }
  console.log(`${seen} emails with stored HTML: ${bulk} bulk, ${derived} take their text from the HTML, ${styled} keep bold or italic runs${failed ? `, ${failed} FAILED and left as they are` : ""}.`);
}

run(process.argv.includes("--apply")).catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
