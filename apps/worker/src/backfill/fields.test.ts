import { test } from "node:test";
import assert from "node:assert/strict";
import { decryptField, deriveUserKeys, isCiphertext, newDataKey } from "@messages/crypto";
import { FIELD } from "@messages/crypto/fields";
import { errorCodeFor, planRow, SPECS } from "./fields";

const keys = await deriveUserKeys(newDataKey());
const spec = (table: string) => SPECS.find((s) => s.table === table)!;

test("encrypting seals each readable value and leaves empty and sealed ones alone", async () => {
  const sealed = await (await import("@messages/crypto")).encryptField(keys, FIELD.contactRole, "Plumber");
  const plan = await planRow(keys, spec("contacts"), { company: "Acme", role: sealed, relationship: "", style_note: null, ai_summary: "Likes brevity" }, "encrypt");
  assert.deepEqual(Object.keys(plan!.set).sort(), ["ai_summary", "company"]);
  assert.deepEqual(plan!.expect, { company: "Acme", ai_summary: "Likes brevity" });
  assert.equal(isCiphertext(plan!.set.company), true);
  assert.equal(await decryptField(keys, FIELD.contactCompany, plan!.set.company as string), "Acme");
  assert.equal(await decryptField(keys, FIELD.contactSummary, plan!.set.ai_summary as string), "Likes brevity");
});

test("a row already in the wanted form needs nothing, either way", async () => {
  assert.equal(await planRow(keys, spec("writing_examples"), { situation: null, body: "" }, "encrypt"), null);
  assert.equal(await planRow(keys, spec("writing_examples"), { situation: "plain", body: "plain" }, "decrypt"), null);
});

test("decrypting restores the exact plain text", async () => {
  const enc = await planRow(keys, spec("calendar_events"), { title: "Lunch with Sipho", location: "Café 1" }, "encrypt");
  const back = await planRow(keys, spec("calendar_events"), enc!.set, "decrypt");
  assert.deepEqual(back!.set, { title: "Lunch with Sipho", location: "Café 1" });
});

test("a value sealed for another field fails to open and is reported, never half written", async () => {
  const wrong = await (await import("@messages/crypto")).encryptField(keys, FIELD.subject, "x");
  await assert.rejects(planRow(keys, spec("style_rules"), { rule: wrong, relationship: null }, "decrypt"));
});

test("a file name is sealed and the three values SQL needs are set from the plain name", async () => {
  const plan = await planRow(keys, spec("attachments"), { filename: "Invoice 4411.PDF" }, "encrypt");
  assert.equal(plan!.set.file_ext, "pdf");
  assert.equal(plan!.set.keep_hint, true);
  assert.equal(plan!.set.is_sticker, false);
  assert.equal(isCiphertext(plan!.set.filename), true);
  const sticker = await planRow(keys, spec("attachments"), { filename: "Sticker.webp" }, "encrypt");
  assert.equal(sticker!.set.is_sticker, true);
  // Going back does not touch the derived columns: they stay correct for the plain name.
  const back = await planRow(keys, spec("attachments"), { filename: plan!.set.filename }, "decrypt");
  assert.deepEqual(Object.keys(back!.set), ["filename"]);
});

test("error text becomes a code; a code is left as it is", () => {
  assert.equal(errorCodeFor("email_originals", "This email is no longer in your mailbox."), "gone");
  assert.equal(errorCodeFor("email_originals", "gone"), null);
  assert.equal(errorCodeFor("briefs", "Gemini said: quota exceeded for user@example.com"), "failed");
  assert.equal(errorCodeFor("briefs", null), null);
  assert.equal(errorCodeFor("briefs", "failed"), null);
});
