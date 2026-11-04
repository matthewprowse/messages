// Tests for send/attachment-rules.ts: per-provider size limits on encoded size, the ten file cap, the wait-or-error rule for missing file rows,
// the sender's own outbox folder check, storage path encoding, safe names and types, and opening sealed files and names.

import { test } from "node:test";
import assert from "node:assert/strict";
import { deriveUserKeys, encryptAt, encryptBytes, encryptBytesAt, encryptField, newDataKey } from "@messages/crypto";
import { FIELD } from "@messages/crypto/fields";
import {
  MAX_ATTACHMENTS, TOO_MANY, attachmentProgress, encodedEmailBytes, leastPlainBytes, limitError, openOutboxFile, openOutboxName, ownOutboxPath,
  safeFilename, safeMimeType, storageUrlPath,
} from "./attachment-rules";

const MB = 1024 * 1024;

test("email limits count all files together, as sent", () => {
  assert.equal(limitError("icloud", [7 * MB, 7 * MB]), null);
  assert.equal(limitError("icloud", [10 * MB, 10 * MB]), "iCloud Mail allows up to 20 MB per email. Attachments grow by about a third when sent.");
  assert.equal(limitError("icloud", [16 * MB]), "iCloud Mail allows up to 20 MB per email. Attachments grow by about a third when sent.");
  assert.equal(limitError("gmail", [18 * MB]), null);
  assert.equal(limitError("gmail", [19 * MB]), "Gmail allows up to 25 MB per email. Attachments grow by about a third when sent.");
  assert.equal(limitError("gmail", []), null);
  assert.equal(limitError("imap", [16 * MB]), "Your mail server allows up to 20 MB per email. Attachments grow by about a third when sent.");
});

test("the encoded size is about a third larger than the files", () => {
  const size = encodedEmailBytes([3 * MB]);
  assert.ok(size > 4 * MB && size < 4.2 * MB);
});

test("the WhatsApp limit is per file", () => {
  assert.equal(limitError("whatsapp", [45 * MB, 45 * MB]), null);
  assert.equal(limitError("whatsapp", [50 * MB + 1]), "Each attachment can be up to 50 MB on WhatsApp.");
});

test("the LinkedIn limit is per file", () => {
  assert.equal(limitError("linkedin", [20 * MB, 20 * MB]), null);
  assert.equal(limitError("linkedin", [20 * MB + 1]), "Each attachment can be up to 20 MB on LinkedIn.");
});

test("no more than ten files", () => {
  assert.equal(limitError("gmail", Array(MAX_ATTACHMENTS).fill(1)), null);
  assert.equal(limitError("gmail", Array(MAX_ATTACHMENTS + 1).fill(1)), TOO_MANY);
});

test("fewer file rows than expected means wait; more is an error", () => {
  assert.equal(attachmentProgress(2, 0), "waiting");
  assert.equal(attachmentProgress(2, 1), "waiting");
  assert.equal(attachmentProgress(2, 2), "ready");
  assert.equal(attachmentProgress(2, 3), "too_many");
  assert.equal(attachmentProgress(0, 0), "ready");
  assert.equal(attachmentProgress(0, 1), "too_many");
});

test("files must be exactly in the sender's own outbox folder", () => {
  const user = "8b1d6f2e-0000-4000-8000-000000000001";
  const file = "0f0e1d2c-3b4a-4958-8776-a5b4c3d2e1f0";
  assert.ok(ownOutboxPath(user, `${user}/outbox/${file}/file`));
  assert.ok(ownOutboxPath(user, `${user}/outbox/${file}/Plan.pdf`));
  assert.ok(ownOutboxPath(user, `${user}/outbox/${file}/Pasted Image (2)-v1.png`));
  assert.ok(!ownOutboxPath(user, `${user}/outbox/1f0c/Plan.pdf`));
  assert.ok(!ownOutboxPath(user, `${user}/outbox/Plan.pdf`));
  assert.ok(!ownOutboxPath(user, `${user}/message/${file}/Plan.pdf`));
  assert.ok(!ownOutboxPath(user, `8b1d6f2e-0000-4000-8000-000000000002/outbox/${file}/Plan.pdf`));
  assert.ok(!ownOutboxPath(user, `${user}/outbox/../../other/x`));
  assert.ok(!ownOutboxPath(user, `${user}/outbox/%2e%2e/%2e%2e/%2e%2e/rest/v1/account_credentials`));
  assert.ok(!ownOutboxPath(user, `${user}/outbox/${file}/%2e%2e`));
  assert.ok(!ownOutboxPath(user, `${user}/outbox/${file}/..`));
  assert.ok(!ownOutboxPath(user, `${user}/outbox/${file}/a/b.pdf`));
  assert.ok(!ownOutboxPath(user, `${user}/outbox//x`));
  assert.ok(!ownOutboxPath(".*", `x/outbox/${file}/Plan.pdf`));
});

test("storage paths are encoded folder by folder", () => {
  assert.equal(storageUrlPath("u/outbox/f/Pasted Image.png"), "u/outbox/f/Pasted%20Image.png");
  assert.equal(storageUrlPath("u/outbox/f/%2e%2e"), "u/outbox/f/%252e%252e");
});

test("types and names are made safe", () => {
  assert.equal(safeMimeType("Application/PDF"), "application/pdf");
  assert.equal(safeMimeType("image/svg+xml"), "image/svg+xml");
  assert.equal(safeMimeType("text/html\r\nX-Evil: 1"), "application/octet-stream");
  assert.equal(safeMimeType(""), "application/octet-stream");
  assert.equal(safeFilename("Plan\r\nBcc: x.pdf"), "Plan Bcc: x.pdf");
  assert.equal(safeFilename("../../etc/passwd"), ".. .. etc passwd");
  assert.equal(safeFilename("  "), "attachment");
  assert.equal(safeFilename("Café menu.png"), "Café menu.png");
});

const USER = "caabe3e9-0000-4000-8000-000000000001";
const OUTBOX = "caabe3e9-0000-4000-8000-0000000000b1";
const PATH = `${USER}/outbox/caabe3e9-0000-4000-8000-0000000000c1/file`;
const keys = await deriveUserKeys(newDataKey(), USER);
const noKeys = () => Promise.reject(Object.assign(new Error("key service down"), { code: "KMS" }));
const strict = { sealed: true, legacy: false };
const lenient = { sealed: false, legacy: true };

test("a sealed outbox file opens with the user's key at its own path; a plain upload is read only with encryption off", async () => {
  const plain = new TextEncoder().encode("%PDF-1.7 quote");
  const sealed = await encryptBytesAt(keys, FIELD.outboxFileData, `attachments/${PATH}`, plain);
  assert.deepEqual(await openOutboxFile(sealed, async () => keys, PATH, strict), plain);
  assert.deepEqual(await openOutboxFile(plain, noKeys, PATH, lenient), plain);
  assert.equal(await openOutboxFile(plain, noKeys, PATH, strict), null);
});

test("a sealed outbox file that will not open, or was sealed for another path, is refused, and a key outage throws", async () => {
  const plain = Uint8Array.from([1, 2, 3]);
  const where = `attachments/${PATH}`;
  const altered = await encryptBytesAt(keys, FIELD.outboxFileData, where, plain);
  altered[altered.length - 1] ^= 1;
  assert.equal(await openOutboxFile(altered, async () => keys, PATH, strict), null);
  assert.equal(await openOutboxFile(await encryptBytesAt(keys, FIELD.attachmentData, where, plain), async () => keys, PATH, strict), null);
  assert.equal(await openOutboxFile(await encryptBytesAt(keys, FIELD.outboxFileData, where.replace("c1", "c2"), plain), async () => keys, PATH, strict), null);
  assert.equal(await openOutboxFile(await encryptBytesAt(await deriveUserKeys(newDataKey(), USER), FIELD.outboxFileData, where, plain), async () => keys, PATH, strict), null);
  await assert.rejects(openOutboxFile(await encryptBytesAt(keys, FIELD.outboxFileData, where, plain), noKeys, PATH, strict));
  // An older "e1b:" upload opens until legacy files are refused.
  const legacy = await encryptBytes(keys, FIELD.outboxFileData, plain);
  assert.deepEqual(await openOutboxFile(legacy, async () => keys, PATH, { sealed: true, legacy: true }), plain);
  assert.equal(await openOutboxFile(legacy, async () => keys, PATH, strict), null);
});

test("an outbox file name opens only for its own row and file, and plain only with encryption off", async () => {
  const named = await encryptAt(keys, FIELD.filename, { place: "outbox_attachments.filename", row: `${OUTBOX}:${PATH}` }, "Offer 12 Main Rd.pdf");
  assert.equal(await openOutboxName(named, async () => keys, OUTBOX, PATH, strict), "Offer 12 Main Rd.pdf");
  assert.equal(await openOutboxName(named, async () => keys, "caabe3e9-0000-4000-8000-0000000000b2", PATH, strict), null);
  assert.equal(await openOutboxName(named, async () => keys, OUTBOX, PATH.replace("c1", "c2"), strict), null);
  assert.equal(await openOutboxName("Plan.pdf", noKeys, OUTBOX, PATH, lenient), "Plan.pdf");
  assert.equal(await openOutboxName("Plan.pdf", noKeys, OUTBOX, PATH, strict), null);
  assert.equal(await openOutboxName(await encryptAt(keys, FIELD.body, { place: "outbox_attachments.filename", row: `${OUTBOX}:${PATH}` }, "Plan.pdf"), async () => keys, OUTBOX, PATH, strict), null);
  assert.equal(await openOutboxName(await encryptField(keys, FIELD.filename, "Old.pdf"), async () => keys, OUTBOX, PATH, { sealed: true, legacy: true }), "Old.pdf");
});

test("the stored size check counts only what a sealed object surely holds", () => {
  assert.equal(leastPlainBytes(1000), 964);
  assert.equal(leastPlainBytes(10), 1);
  assert.equal(limitError("whatsapp", [leastPlainBytes(50 * MB + 36)]), null);
  assert.notEqual(limitError("whatsapp", [leastPlainBytes(50 * MB + 37)]), null);
});
