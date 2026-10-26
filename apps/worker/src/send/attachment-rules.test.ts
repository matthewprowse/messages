import { test } from "node:test";
import assert from "node:assert/strict";
import { MAX_ATTACHMENTS, TOO_MANY, attachmentProgress, encodedEmailBytes, limitError, ownOutboxPath, safeFilename, safeMimeType, storageUrlPath } from "./attachment-rules";

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
