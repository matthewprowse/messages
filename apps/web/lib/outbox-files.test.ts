// Tests for outbox-files.ts: per-provider attachment limits, the file count cap, cleaning of file names, and the sealed
// upload with no real name in its path.

import { test } from "node:test";
import assert from "node:assert/strict";
import { decryptBytes, deriveUserKeys, encryptBytesAt, isSealedBytes, newDataKey } from "@messages/crypto";
import {
  MAX_FILES,
  attachProvider,
  attachmentRows,
  displayName,
  kindOf,
  limitError,
  mimeOf,
  outboxPath,
  pastedName,
  pendingAttachments,
  sealOutboxBytes,
  shouldTakePastedFiles,
  uniqueName,
  uploadMessage,
  uploadStatus,
  uploadUrl,
} from "./outbox-files";

const MB = 1024 * 1024;
const file = (size: number, name = "a.pdf") => ({ name, size });

test("attachProvider allows email and WhatsApp, not Calendar", () => {
  assert.equal(attachProvider("icloud"), "icloud");
  assert.equal(attachProvider("imap"), "imap");
  assert.equal(attachProvider("gmail"), "gmail");
  assert.equal(attachProvider("whatsapp"), "whatsapp");
  assert.equal(attachProvider("google_calendar"), null);
  assert.equal(attachProvider(undefined), null);
});

test("iCloud Mail allows 20 MB in total, as sent", () => {
  assert.equal(limitError("icloud", [file(7 * MB), file(7 * MB)]), null);
  assert.equal(limitError("icloud", [file(16 * MB)]), "iCloud Mail allows up to 20 MB per email. Attachments grow by about a third when sent.");
});

test("Gmail allows 25 MB in total, as sent", () => {
  assert.equal(limitError("gmail", [file(18 * MB)]), null);
  assert.equal(limitError("gmail", [file(10 * MB), file(9 * MB)]), "Gmail allows up to 25 MB per email. Attachments grow by about a third when sent.");
});

test("WhatsApp allows 50 MB per file, not in total, with room for the sealed upload's few extra bytes", () => {
  assert.equal(limitError("whatsapp", [file(45 * MB), file(45 * MB)]), null);
  assert.equal(limitError("whatsapp", [file(50 * MB - 36)]), null);
  assert.equal(limitError("whatsapp", [file(50 * MB)]), "WhatsApp files can be up to 50 MB each here.");
});

test("at most 10 files, and none empty", () => {
  const ten = Array.from({ length: MAX_FILES }, () => file(1));
  assert.equal(limitError("gmail", ten), null);
  assert.equal(limitError("gmail", [...ten, file(1)]), "Attach up to 10 files per message.");
  assert.equal(limitError("icloud", [file(0, "notes.txt")]), "notes.txt is empty.");
});

test("displayName removes control characters and slashes and keeps the extension when cut", () => {
  assert.equal(displayName("  Q3\u0000 report/final\\v2.pdf  "), "Q3 report-final-v2.pdf");
  assert.equal(displayName("..hidden"), "hidden");
  assert.equal(displayName("   "), "Attachment");
  const long = displayName(`${"x".repeat(300)}.docx`);
  assert.equal(long.length, 255);
  assert.ok(long.endsWith(".docx"));
});

test("outboxPath puts files under the user's outbox folder with no real name in the path", () => {
  const path = outboxPath("u1", "f1");
  assert.equal(path, "u1/outbox/f1/file");
  assert.deepEqual(path.split("/").slice(0, 3), ["u1", "outbox", "f1"]);
});

test("sealOutboxBytes uploads only ciphertext, which opens again as the outbox file field at its own path and no other", async () => {
  const keys = await deriveUserKeys(newDataKey(), "u1");
  const plain = new TextEncoder().encode("%PDF-1.7 invoice");
  const where = "attachments/u1/outbox/f1/file";
  const blob = await sealOutboxBytes(new Blob([plain], { type: "application/pdf" }), (field, bytes) => encryptBytesAt(keys, field, where, bytes));
  const sealed = new Uint8Array(await blob.arrayBuffer());
  assert.equal(blob.type, "application/octet-stream");
  assert.ok(isSealedBytes(sealed));
  assert.equal(sealed.length, plain.length + 36);
  assert.deepEqual(await decryptBytes(keys, "outbox_file_data", sealed, where), plain);
  await assert.rejects(decryptBytes(keys, "attachment_data", sealed, where));
  await assert.rejects(decryptBytes(keys, "outbox_file_data", sealed, "attachments/u1/outbox/f2/file"));
});

test("uploadUrl encodes each segment", () => {
  assert.equal(
    uploadUrl("https://x.supabase.co/", "u1/outbox/f1/My File (1).pdf"),
    "https://x.supabase.co/storage/v1/object/attachments/u1/outbox/f1/My%20File%20(1).pdf",
  );
});

test("mimeOf prefers the browser's type and guesses from the extension", () => {
  assert.equal(mimeOf("a.bin", "Image/PNG"), "image/png");
  assert.equal(mimeOf("Report.PDF", ""), "application/pdf");
  assert.equal(mimeOf("deck.key", ""), "application/vnd.apple.keynote");
  assert.equal(mimeOf("mystery", ""), "application/octet-stream");
  assert.equal(mimeOf("a.txt", "Text/Plain; charset=utf-8\r\nX-Evil: 1"), "text/plain");
  assert.equal(kindOf("image/heic"), "image");
  assert.equal(kindOf("video/mp4"), "video");
  assert.equal(kindOf("audio/webm"), "audio");
  assert.equal(kindOf("application/pdf"), "pdf");
  assert.equal(kindOf("text/plain"), "file");
});

test("uniqueName and pastedName number repeats", () => {
  assert.equal(uniqueName("a.png", []), "a.png");
  assert.equal(uniqueName("a.png", ["A.png", "a 2.png"]), "a 3.png");
  assert.equal(pastedName("image/png", []), "Pasted Image.png");
  assert.equal(pastedName("image/jpeg", ["Pasted Image.jpg"]), "Pasted Image 2.jpg");
  assert.equal(pastedName("", []), "Pasted Image.png");
});

test("pasted files are only taken when there is no plain text", () => {
  assert.equal(shouldTakePastedFiles(["Files"], 1), true);
  assert.equal(shouldTakePastedFiles(["text/html", "Files"], 1), true);
  assert.equal(shouldTakePastedFiles(["text/plain", "text/html", "Files"], 1), false);
  assert.equal(shouldTakePastedFiles(["text/plain"], 0), false);
});

test("attachmentRows and pendingAttachments keep the order files were added in", () => {
  const files = [
    { path: "u/outbox/1/a.png", filename: "a.png", mimeType: "image/png", size: 2048 },
    { path: "u/outbox/2/b.pdf", filename: "b.pdf", mimeType: "application/pdf", size: 3 * MB },
  ];
  assert.deepEqual(attachmentRows("o1", files), [
    { outbox_id: "o1", storage_path: "u/outbox/1/a.png", filename: "a.png", mime_type: "image/png", size_bytes: 2048, position: 0, voice_note: false },
    { outbox_id: "o1", storage_path: "u/outbox/2/b.pdf", filename: "b.pdf", mime_type: "application/pdf", size_bytes: 3 * MB, position: 1, voice_note: false },
  ]);
  assert.deepEqual(pendingAttachments(files).map((a) => [a.kind, a.size, a.path, a.sealed]), [
    ["image", "2 KB", "u/outbox/1/a.png", true],
    ["pdf", "3.0 MB", "u/outbox/2/b.pdf", true],
  ]);
});

test("upload failures read the code Storage puts in the body", () => {
  assert.equal(uploadStatus(400, '{"statusCode":"403","error":"Unauthorized","message":"new row violates row-level security policy"}'), 403);
  assert.equal(uploadStatus(400, '{"statusCode":"413","error":"Payload too large"}'), 413);
  assert.equal(uploadStatus(502, "<html>Bad Gateway</html>"), 502);
  assert.equal(uploadMessage(413), "Too Large to Upload");
  assert.equal(uploadMessage(401), "Sign In Again to Upload");
  assert.equal(uploadMessage(403), "Upload Not Allowed");
  assert.equal(uploadMessage(0), "Upload Failed. Check Your Connection.");
});
